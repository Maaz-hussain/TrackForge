import express from 'express';
import path from 'path';
import net from 'net';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import mysql from 'mysql2/promise';
import { createServer as createViteServer } from 'vite';
import {
  CognexDeviceState,
  PrinterDeviceState,
  ScanToPrintPipeline,
  SystemState,
  BarcodeRead,
  PrintJob,
  TelnetLogEntry,
} from './src/types';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DEFAULT_PRINTER_HOST = '192.168.1.5';
const DEFAULT_PRINTER_PORT = 9944;
const DEFAULT_COGNEX_HOST = process.env.COGNEX_HOST || '169.254.76.4';
const DEFAULT_COGNEX_PORT = Number(process.env.COGNEX_PORT || 23);
const MAX_PRINTER_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_COGNEX_FTP_IMAGE_DIR = path.join(process.cwd(), 'data', 'cognex-ftp-images');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp']);
const SCAN_BATCH_INTERVAL_MS = 100;
const SCAN_BATCH_MAX_SIZE = 100;
const SCAN_QUEUE_MAX_SIZE = 10000;
const SCAN_DEDUPE_TTL_MS = 5000;
const SCAN_MAX_MATCH_ATTEMPTS = 5;

app.use(express.json());

type RecipeFieldMode = 'fixed' | 'recipe' | 'serial';

type RecipeFieldInput = {
  fieldId: number;
  fieldType: string;
  fieldName?: string;
  mode: RecipeFieldMode;
  value?: string;
  serialPrefix?: string;
  serialLength?: number;
};

let mysqlPool: mysql.Pool | null = null;
let recipeSchemaReady: Promise<void> | null = null;

function getMysqlPool() {
  if (mysqlPool) return mysqlPool;
  const database = process.env.MYSQL_DATABASE;
  if (!database) {
    throw new Error('MYSQL_DATABASE is not configured. Add MySQL settings to .env before using printer recipes.');
  }
  mysqlPool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3307),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'Springboot@123',
    database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  });
  return mysqlPool;
}

function getCognexImageDirectory() {
  return cognexState.config.ftpImageDirectory || process.env.COGNEX_FTP_IMAGE_DIR || DEFAULT_COGNEX_FTP_IMAGE_DIR;
}

function ensureCognexImageDirectory() {
  const directory = getCognexImageDirectory();
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function listCognexImages(limit = 25) {
  const directory = ensureCognexImageDirectory();
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const fullPath = path.join(directory, entry.name);
      const stats = fs.statSync(fullPath);
      return {
        filename: entry.name,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        url: `/api/cognex/image/${encodeURIComponent(entry.name)}`,
      };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, Math.min(100, Math.max(1, Number(limit) || 25)));
  return { directory, images: files };
}

function resolveCognexImagePath(filename: string) {
  const directory = ensureCognexImageDirectory();
  const safeName = path.basename(filename);
  const target = path.resolve(directory, safeName);
  const relative = path.relative(directory, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid image path.');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error('Image not found.');
  }
  return target;
}

async function ensureRecipeSchema() {
  if (recipeSchemaReady) return recipeSchemaReady;
  recipeSchemaReady = (async () => {
    const pool = getMysqlPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS printer_recipes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        message_id BIGINT NOT NULL,
        message_name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_printer_recipes_message (message_id),
        INDEX idx_printer_recipes_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS printer_recipe_fields (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        recipe_id BIGINT UNSIGNED NOT NULL,
        field_id BIGINT NOT NULL,
        field_type VARCHAR(80) NOT NULL,
        field_name VARCHAR(255) NOT NULL,
        mode ENUM('fixed','recipe','serial') NOT NULL DEFAULT 'recipe',
        value TEXT NULL,
        serial_prefix VARCHAR(80) NULL,
        serial_length INT NOT NULL DEFAULT 14,
        serial_counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_recipe_field (recipe_id, field_id, field_type),
        CONSTRAINT fk_printer_recipe_fields_recipe
          FOREIGN KEY (recipe_id) REFERENCES printer_recipes(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS printer_recipe_serials (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        recipe_id BIGINT UNSIGNED NOT NULL,
        serial_value VARCHAR(80) NOT NULL,
        uuid_value CHAR(36) NOT NULL,
        gtin_part VARCHAR(32) NOT NULL,
        complete_code TEXT NULL,
        print_status ENUM('generated','printing_pending','printed','failed') NOT NULL DEFAULT 'generated',
        verification_status ENUM('pending','scanned','verified','failed') NOT NULL DEFAULT 'pending',
        printer_response JSON NULL,
        error_message TEXT NULL,
        generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        printed_at TIMESTAMP NULL DEFAULT NULL,
        verified_at TIMESTAMP NULL DEFAULT NULL,
        UNIQUE KEY uniq_printer_recipe_serial (recipe_id, serial_value),
        INDEX idx_printer_recipe_serial_status (recipe_id, print_status, verification_status),
        INDEX idx_printer_recipe_complete_code (complete_code(191)),
        CONSTRAINT fk_printer_recipe_serials_recipe
          FOREIGN KEY (recipe_id) REFERENCES printer_recipes(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    try {
      await pool.query('ALTER TABLE printer_recipe_serials ADD COLUMN complete_code TEXT NULL AFTER gtin_part');
    } catch (error: any) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
    await pool.query(`
      ALTER TABLE printer_recipe_serials
      MODIFY COLUMN verification_status ENUM('pending','scanned','verified','failed') NOT NULL DEFAULT 'pending'
    `);
    try {
      await pool.query('CREATE INDEX idx_printer_recipe_complete_code ON printer_recipe_serials (complete_code(191))');
    } catch (error: any) {
      if (error?.code !== 'ER_DUP_KEYNAME') throw error;
    }
    await backfillMissingCompleteCodes(pool);
  })();
  return recipeSchemaReady;
}

function normalizeRecipeFields(fields: any[]): RecipeFieldInput[] {
  if (!Array.isArray(fields) || fields.length === 0) throw new Error('Recipe fields are required.');
  return fields.map((field) => {
    const mode = String(field.mode || 'recipe') as RecipeFieldMode;
    if (!['fixed', 'recipe', 'serial'].includes(mode)) throw new Error(`Invalid field mode: ${mode}`);
    const fieldId = Number(field.fieldId);
    if (!Number.isInteger(fieldId)) throw new Error('Every recipe field needs a numeric fieldId.');
    return {
      fieldId,
      fieldType: String(field.fieldType || 'text'),
      fieldName: String(field.fieldName || ''),
      mode,
      value: String(field.value ?? ''),
      serialPrefix: String(field.serialPrefix ?? ''),
      serialLength: Math.min(32, Math.max(1, Number(field.serialLength || 14))),
    };
  });
}

async function readRecipe(recipeId: number) {
  await ensureRecipeSchema();
  const pool = getMysqlPool();
  const [recipeRows] = await pool.query<any[]>(
    'SELECT id, name, message_id AS messageId, message_name AS messageName, description, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM printer_recipes WHERE id = ?',
    [recipeId],
  );
  const recipe = recipeRows[0];
  if (!recipe) return null;
  const [fieldRows] = await pool.query<any[]>(
    `SELECT
      id,
      recipe_id AS recipeId,
      field_id AS fieldId,
      field_type AS fieldType,
      field_name AS fieldName,
      mode,
      value,
      serial_prefix AS serialPrefix,
      serial_length AS serialLength,
      serial_counter AS serialCounter
    FROM printer_recipe_fields
    WHERE recipe_id = ?
    ORDER BY id`,
    [recipeId],
  );
  return { ...recipe, fields: fieldRows };
}

async function listRecipes(messageId?: number) {
  await ensureRecipeSchema();
  const pool = getMysqlPool();
  const [rows] = await pool.query<any[]>(
    `SELECT
      id,
      name,
      message_id AS messageId,
      message_name AS messageName,
      description,
      is_active AS isActive,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM printer_recipes
    ${Number.isInteger(messageId) ? 'WHERE message_id = ?' : ''}
    ORDER BY updated_at DESC`,
    Number.isInteger(messageId) ? [messageId] : [],
  );
  return rows;
}

async function saveRecipe(input: any, recipeId?: number) {
  await ensureRecipeSchema();
  const pool = getMysqlPool();
  const name = String(input.name || '').trim();
  const messageId = Number(input.messageId);
  const messageName = String(input.messageName || '').trim();
  if (!name) throw new Error('Recipe name is required.');
  if (!Number.isInteger(messageId)) throw new Error('Recipe messageId is required.');
  if (!messageName) throw new Error('Recipe messageName is required.');
  const fields = normalizeRecipeFields(input.fields || []);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let id = recipeId;
    if (id) {
      await connection.query(
        'UPDATE printer_recipes SET name = ?, message_id = ?, message_name = ?, description = ? WHERE id = ?',
        [name, messageId, messageName, String(input.description || ''), id],
      );
      await connection.query('DELETE FROM printer_recipe_fields WHERE recipe_id = ?', [id]);
    } else {
      const [result] = await connection.query<mysql.ResultSetHeader>(
        'INSERT INTO printer_recipes (name, message_id, message_name, description) VALUES (?, ?, ?, ?)',
        [name, messageId, messageName, String(input.description || '')],
      );
      id = result.insertId;
    }

    for (const field of fields) {
      await connection.query(
        `INSERT INTO printer_recipe_fields
          (recipe_id, field_id, field_type, field_name, mode, value, serial_prefix, serial_length)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, field.fieldId, field.fieldType, field.fieldName || '', field.mode, field.value || '', field.serialPrefix || '', field.serialLength || 14],
      );
    }
    await connection.commit();
    return readRecipe(Number(id));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function getRecipeGtinDigits(recipe: any) {
  const gtinField = recipe.fields.find((field: any) =>
    /gtin/i.test(field.fieldName || '') ||
    String(field.value || '').replace(/\D/g, '').startsWith('01')
  );
  const digits = String(gtinField?.value || '').replace(/\D/g, '');
  if (digits.startsWith('01') && digits.length >= 16) return digits.slice(2, 16);
  if (digits.length >= 8) return digits;
  return String(recipe.messageId || '').replace(/\D/g, '') || '0';
}

function buildUuidGtinSerial(recipe: any, serialField: any) {
  const serialLength = Math.min(32, Math.max(1, Number(serialField.serialLength || 14)));
  const gtinDigits = getRecipeGtinDigits(recipe);
  const gtinPartLength = Math.min(Math.max(2, Math.floor(serialLength / 3)), Math.min(6, serialLength));
  const gtinPart = gtinDigits.slice(-gtinPartLength).padStart(gtinPartLength, '0');
  const uuid = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(`${uuid}:${gtinPart}`).digest('hex');
  const numericHash = BigInt(`0x${hash}`).toString(10);
  const suffixLength = Math.max(0, serialLength - gtinPart.length);
  const suffix = numericHash.slice(-suffixLength).padStart(suffixLength, '0');
  return {
    serialValue: `${gtinPart}${suffix}`.slice(0, serialLength),
    uuid,
    gtinPart,
  };
}

function stripCodeBrackets(value: string) {
  return value.replace(/[()[\]{}]/g, '');
}

function normalizeScannedCode(value: string) {
  return stripCodeBrackets(value.trim())
    .replace(/^</, '')
    .replace(/^\]d[12]/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

type PendingScan = {
  code: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrences: number;
  attempts: number;
  availableAt: number;
};

const pendingScans = new Map<string, PendingScan>();
const scanCodesInFlight = new Set<string>();
const recentlyProcessedScans = new Map<string, number>();
let scanFlushTimer: ReturnType<typeof setTimeout> | null = null;
let scanFlushInProgress = false;
let lastProcessedScanPruneAt = 0;

function pruneProcessedScanCache(now = Date.now()) {
  if (now - lastProcessedScanPruneAt < 1000) return;
  lastProcessedScanPruneAt = now;
  for (const [code, expiresAt] of recentlyProcessedScans) {
    if (expiresAt <= now) recentlyProcessedScans.delete(code);
  }
}

function scheduleScanFlush(delayMs = SCAN_BATCH_INTERVAL_MS) {
  if (scanFlushInProgress || pendingScans.size === 0) return;
  if (scanFlushTimer) {
    if (delayMs > 0) return;
    clearTimeout(scanFlushTimer);
  }
  scanFlushTimer = setTimeout(() => {
    scanFlushTimer = null;
    void flushScanBatch();
  }, delayMs);
}

function requeueScan(scan: PendingScan, delayMs: number) {
  scanCodesInFlight.delete(scan.code);
  const existing = pendingScans.get(scan.code);
  if (existing) {
    existing.occurrences += scan.occurrences;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, scan.lastSeenAt);
    existing.availableAt = Math.min(existing.availableAt, Date.now() + delayMs);
    return;
  }
  pendingScans.set(scan.code, { ...scan, availableAt: Date.now() + delayMs });
}

async function flushScanBatch() {
  if (scanFlushInProgress || pendingScans.size === 0) return;
  scanFlushInProgress = true;
  const now = Date.now();
  const batch: PendingScan[] = [];
  let nextAvailableAt = Number.POSITIVE_INFINITY;

  for (const [code, scan] of pendingScans) {
    if (scan.availableAt > now) {
      nextAvailableAt = Math.min(nextAvailableAt, scan.availableAt);
      continue;
    }
    pendingScans.delete(code);
    scanCodesInFlight.add(code);
    batch.push(scan);
    if (batch.length >= SCAN_BATCH_MAX_SIZE) break;
  }

  if (batch.length === 0) {
    scanFlushInProgress = false;
    scheduleScanFlush(Number.isFinite(nextAvailableAt) ? Math.max(1, nextAvailableAt - now) : SCAN_BATCH_INTERVAL_MS);
    return;
  }

  try {
    await ensureRecipeSchema();
    const pool = getMysqlPool();
    const placeholders = batch.map(() => '?').join(',');
    const [rows] = await pool.query<any[]>(
      `SELECT id, serial_value AS serialValue, complete_code AS completeCode,
              verification_status AS verificationStatus
       FROM printer_recipe_serials
       WHERE complete_code IN (${placeholders})`,
      batch.map((scan) => scan.code),
    );
    const matches = new Map(rows.map((row) => [normalizeScannedCode(String(row.completeCode)), row]));
    const idsToMark = rows
      .filter((row) => !['scanned', 'verified'].includes(row.verificationStatus))
      .map((row) => Number(row.id));

    if (idsToMark.length > 0) {
      const idPlaceholders = idsToMark.map(() => '?').join(',');
      await pool.query(
        `UPDATE printer_recipe_serials
         SET verification_status = 'scanned', verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
         WHERE id IN (${idPlaceholders})
           AND verification_status NOT IN ('scanned', 'verified')`,
        idsToMark,
      );
    }

    let retrying = 0;
    let unmatched = 0;
    for (const scan of batch) {
      scanCodesInFlight.delete(scan.code);
      if (matches.has(scan.code)) {
        recentlyProcessedScans.set(scan.code, Date.now() + SCAN_DEDUPE_TTL_MS);
        continue;
      }
      scan.attempts += 1;
      if (scan.attempts < SCAN_MAX_MATCH_ATTEMPTS) {
        retrying += 1;
        requeueScan(scan, Math.min(500 * (2 ** (scan.attempts - 1)), 4000));
      } else {
        unmatched += 1;
        recentlyProcessedScans.set(scan.code, Date.now() + SCAN_DEDUPE_TTL_MS);
      }
    }

    addCognexLog(
      'system',
      `Scan batch processed: ${matches.size} matched, ${idsToMark.length} marked scanned, ${retrying} retrying, ${unmatched} unmatched.`,
    );
  } catch (error: any) {
    for (const scan of batch) requeueScan(scan, 500);
    addCognexLog('error', `Scan batch failed and was requeued: ${error.message}`);
  } finally {
    scanFlushInProgress = false;
    scheduleScanFlush(pendingScans.size >= SCAN_BATCH_MAX_SIZE ? 0 : SCAN_BATCH_INTERVAL_MS);
  }
}

function queueRecipeCodeScan(rawCode: string) {
  const code = normalizeScannedCode(rawCode);
  if (!code) return;
  const now = Date.now();
  pruneProcessedScanCache(now);
  if ((recentlyProcessedScans.get(code) || 0) > now || scanCodesInFlight.has(code)) return;

  const existing = pendingScans.get(code);
  if (existing) {
    existing.lastSeenAt = now;
    existing.occurrences += 1;
    return;
  }
  if (pendingScans.size >= SCAN_QUEUE_MAX_SIZE) {
    addCognexLog('error', `Scan queue is full; dropped code ${code}.`);
    return;
  }

  pendingScans.set(code, {
    code,
    firstSeenAt: now,
    lastSeenAt: now,
    occurrences: 1,
    attempts: 0,
    availableAt: now,
  });
  scheduleScanFlush(pendingScans.size >= SCAN_BATCH_MAX_SIZE ? 0 : SCAN_BATCH_INTERVAL_MS);
}

function buildCompleteRecipeCode(recipe: any, serialValue: string, overrides: Record<string, any> = {}) {
  const fields = buildRecipePrintFields(recipe, serialValue, overrides);
  return normalizeScannedCode(fields.map((field: any) => String(field.value ?? '')).join(''));
}

async function backfillMissingCompleteCodes(pool: mysql.Pool) {
  const [serialRows] = await pool.query<any[]>(
    `SELECT id, recipe_id AS recipeId, serial_value AS serialValue, complete_code AS completeCode
     FROM printer_recipe_serials
     WHERE complete_code IS NULL
        OR complete_code = ''
        OR complete_code LIKE CONCAT('%', CHAR(29), '%')`,
  );
  if (serialRows.length === 0) return;

  const recipeIds = [...new Set(serialRows.map((row) => Number(row.recipeId)))];
  const placeholders = recipeIds.map(() => '?').join(',');
  const [fieldRows] = await pool.query<any[]>(
    `SELECT
       recipe_id AS recipeId,
       field_id AS fieldId,
       field_type AS fieldType,
       field_name AS fieldName,
       mode,
       value,
       serial_prefix AS serialPrefix
     FROM printer_recipe_fields
     WHERE recipe_id IN (${placeholders})
     ORDER BY id`,
    recipeIds,
  );
  const fieldsByRecipe = new Map<number, any[]>();
  for (const field of fieldRows) {
    const fields = fieldsByRecipe.get(Number(field.recipeId)) || [];
    fields.push(field);
    fieldsByRecipe.set(Number(field.recipeId), fields);
  }

  const updates = serialRows
    .map((row) => ({
      id: Number(row.id),
      completeCode: row.completeCode
        ? normalizeScannedCode(String(row.completeCode))
        : buildCompleteRecipeCode(
            { fields: fieldsByRecipe.get(Number(row.recipeId)) || [] },
            String(row.serialValue),
          ),
    }))
    .filter((row) => row.completeCode);

  for (let offset = 0; offset < updates.length; offset += 200) {
    const chunk = updates.slice(offset, offset + 200);
    const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const ids = chunk.map(() => '?').join(',');
    await pool.query(
      `UPDATE printer_recipe_serials
       SET complete_code = CASE id ${cases} ELSE complete_code END
       WHERE id IN (${ids})`,
      [...chunk.flatMap((row) => [row.id, row.completeCode]), ...chunk.map((row) => row.id)],
    );
  }
}

async function createRecipeSerial(
  recipe: any,
  connection?: mysql.PoolConnection,
  overrides: Record<string, any> = {},
) {
  const serialField = recipe.fields.find((field: any) => field.mode === 'serial');
  if (!serialField) throw new Error('Recipe has no dynamic serial field.');
  const executor = connection || getMysqlPool();

  for (let attempt = 0; attempt < 8; attempt++) {
    const generated = buildUuidGtinSerial(recipe, serialField);
    const completeCode = buildCompleteRecipeCode(recipe, generated.serialValue, overrides);
    try {
      const [result] = await executor.query<mysql.ResultSetHeader>(
        `INSERT INTO printer_recipe_serials
          (recipe_id, serial_value, uuid_value, gtin_part, complete_code, print_status, verification_status)
         VALUES (?, ?, ?, ?, ?, 'generated', 'pending')`,
        [recipe.id, generated.serialValue, generated.uuid, generated.gtinPart, completeCode],
      );
      return { id: result.insertId, ...generated, completeCode, printStatus: 'generated', verificationStatus: 'pending' };
    } catch (error: any) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
    }
  }

  throw new Error('Could not generate a unique serial after multiple attempts.');
}

async function listRecipeSerials(recipeId: number, limit = 100) {
  await ensureRecipeSchema();
  const pool = getMysqlPool();
  const [rows] = await pool.query<any[]>(
    `SELECT
      id,
      recipe_id AS recipeId,
      serial_value AS serialValue,
      uuid_value AS uuidValue,
      gtin_part AS gtinPart,
      complete_code AS completeCode,
      print_status AS printStatus,
      verification_status AS verificationStatus,
      printer_response AS printerResponse,
      error_message AS errorMessage,
      generated_at AS generatedAt,
      printed_at AS printedAt,
      verified_at AS verifiedAt
    FROM printer_recipe_serials
    WHERE recipe_id = ?
    ORDER BY id DESC
    LIMIT ?`,
    [recipeId, Math.min(500, Math.max(1, Number(limit) || 100))],
  );
  return rows;
}

function recipeFieldOverrideKey(field: any) {
  return `${field.fieldType}:${field.fieldId}`;
}

function getRecipeFieldOverride(field: any, overrides: Record<string, any> = {}) {
  const compositeKey = recipeFieldOverrideKey(field);
  const fieldIdKey = String(field.fieldId);
  return overrides[compositeKey] ?? overrides[fieldIdKey];
}

function recipeSelectionValue(field: any, overrides: Record<string, any> = {}) {
  const suffix = getRecipeFieldOverride(field, overrides) ?? field.value ?? '';
  return `${field.serialPrefix || ''}${suffix}`;
}

function buildRecipePrintFields(recipe: any, serialValue: string, overrides: Record<string, any> = {}) {
  return recipe.fields.map((field: any) => ({
    fieldId: field.fieldId,
    fieldType: field.fieldType,
    fieldName: field.fieldName,
    value:
      field.mode === 'serial'
        ? `${field.serialPrefix || ''}${serialValue}`
        : field.mode === 'recipe'
        ? recipeSelectionValue(field, overrides)
        : field.value,
  }));
}

function buildRecipeSelectionFields(recipe: any, overrides: Record<string, any> = {}) {
  return recipe.fields
    .filter((field: any) => field.mode !== 'serial')
    .map((field: any) => ({
      fieldId: field.fieldId,
      fieldType: field.fieldType,
      fieldName: field.fieldName,
      value: field.mode === 'recipe' ? recipeSelectionValue(field, overrides) : field.value,
    }));
}

// In-memory state
let cognexState: CognexDeviceState = {
  status: 'disconnected',
  config: {
    host: DEFAULT_COGNEX_HOST,
    port: DEFAULT_COGNEX_PORT,
    user: 'admin',
    password: '',
    timeoutMs: 4000,
    isSimulated: false,
    autoReconnect: true,
    ftpImageDirectory: process.env.COGNEX_FTP_IMAGE_DIR || DEFAULT_COGNEX_FTP_IMAGE_DIR,
  },
  deviceName: 'Cognex DataMan 262X (Line-01)',
  serialNumber: '1A262X-8849204',
  firmware: '6.3.4_SR2',
  ipAddress: DEFAULT_COGNEX_HOST,
  macAddress: '00:0C:8F:A4:7B:12',
  lastRead: {
    id: 'rd_init',
    data: 'DM-PART-99420-A',
    symbology: 'DataMatrix',
    timestamp: Date.now() - 5000,
    decodeTimeMs: 18,
    qualityGrade: 'A',
    printed: true,
  },
  readHistory: [
    {
      id: 'rd_sample_1',
      data: 'DM-PART-99420-A',
      symbology: 'DataMatrix',
      timestamp: Date.now() - 5000,
      decodeTimeMs: 18,
      qualityGrade: 'A',
      printed: true,
    },
    {
      id: 'rd_sample_2',
      data: 'SN2026-X88310',
      symbology: 'Code 128',
      timestamp: Date.now() - 15000,
      decodeTimeMs: 22,
      qualityGrade: 'A',
      printed: true,
    },
  ],
  exposureUs: 1200,
  gain: 1.2,
  focusPosition: 85,
  logs: [
    {
      id: 'log_1',
      timestamp: Date.now() - 6000,
      direction: 'system',
      message: 'Cognex DM 262X Telnet Driver Initialized (Telnet port 23 / DMCC protocol)',
    },
    {
      id: 'log_2',
      timestamp: Date.now() - 5500,
      direction: 'in',
      message: 'Welcome to Cognex DataMan 262X - v6.3.4 (DMCC prompt ready)',
    },
  ],
  totalTriggers: 2,
  goodReads: 2,
  noReads: 0,
};

let printerState: PrinterDeviceState = {
  status: 'disconnected',
  config: {
    host: DEFAULT_PRINTER_HOST,
    port: DEFAULT_PRINTER_PORT,
    protocol: 'TCP_JSON',
    timeoutMs: 4000,
    isSimulated: false,
    autoReconnect: true,
    labelWidthMm: 100,
    labelHeightMm: 50,
    dpi: 300,
    messageName: '',
    dynamicFieldName: 'dynamic_text',
  },
  printerModel: 'Sojet TCP-JSON Industrial Printer',
  isHeadOpen: false,
  isPaperOut: false,
  isPaused: false,
  currentJob: null,
  queue: [],
  history: [
    {
      id: 'job_sample_1',
      timestamp: Date.now() - 4800,
      barcodeData: 'DM-PART-99420-A',
      title: 'Auto-Print: DM-PART-99420-A',
      rawPayload: 'DM-PART-99420-A',
      status: 'completed',
      source: 'auto_scan',
    },
  ],
  logs: [
    {
      id: 'plog_1',
      timestamp: Date.now() - 6000,
      direction: 'system',
      message: 'Printer TCP-JSON manager initialized (documented port 9944)',
    },
  ],
  totalJobsPrinted: 1,
};

let pipelineState: ScanToPrintPipeline = {
  enabled: true,
  autoPrintOnRead: false,
  barcodePrefixFilter: '',
  minBarcodeLength: 3,
  labelTemplate: `^XA
^PW800
^LL400
^FO40,40^A0N,32,32^FDCOGNEX INSPECTION PASSED^FS
^FO40,85^GB720,2,2^FS
^FO40,110^BXN,8,200^FD{BARCODE}^FS
^FO260,110^A0N,28,28^FDSN: {BARCODE}^FS
^FO260,150^A0N,22,22^FDRead Time: {TIMESTAMP}^FS
^FO260,185^A0N,22,22^FDOperator: {OPERATOR}^FS
^FO260,220^A0N,22,22^FDCognex Quality: Grade {QUALITY}^FS
^FO260,255^A0N,22,22^FDDecode: {DECODE_TIME} ms^FS
^FO40,320^GB720,2,2^FS
^FO40,340^A0N,22,22^FDDataMan 262X Verified Label^FS
^XZ`,
  partNumberPrefix: 'PRT',
  operatorId: 'OP-449',
  soundEnabled: true,
  totalMatches: 2,
  totalFiltered: 0,
};

// Sockets
let cognexSocket: net.Socket | null = null;
let cognexTelnetBuffer = Buffer.alloc(0);
let cognexLineBuffer = '';
let cognexLineFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCognexCommand: string | null = null;
let printerSocket: net.Socket | null = null;

type PrinterCommand = {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

type PrinterCommandResult = {
  raw: string;
  data: any;
  elapsedMs: number;
  frame: string;
};

function addCognexLog(direction: TelnetLogEntry['direction'], message: string, isDmcc = false) {
  const entry: TelnetLogEntry = {
    id: 'cog_' + Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
    direction,
    message,
    isDmcc,
  };
  cognexState.logs.unshift(entry);
  if (cognexState.logs.length > 200) {
    cognexState.logs.pop();
  }
}

function addPrinterLog(direction: TelnetLogEntry['direction'], message: string) {
  const entry: TelnetLogEntry = {
    id: 'prn_' + Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
    direction,
    message,
  };
  printerState.logs.unshift(entry);
  if (printerState.logs.length > 200) {
    printerState.logs.pop();
  }
}

function friendlyPrinterNetworkError(error: any, host: string, port: number) {
  const messages: Record<string, string> = {
    EACCES: `Windows denied TCP access to ${host}:${port}. Allow Node.js through Windows Firewall on private networks.`,
    ECONNREFUSED: `The printer at ${host}:${port} refused the connection. Confirm the TCP-JSON service is enabled and the port is correct.`,
    EHOSTUNREACH: `No network route could reach ${host}:${port}. Confirm the PC and printer are on the same LAN.`,
    ENETUNREACH: `The printer network is unreachable from this PC. Check the active network adapter and subnet.`,
    ETIMEDOUT: `The connection to ${host}:${port} timed out. Check the printer IP, port, and firewall rules.`,
  };
  const wrapped = new Error(messages[error?.code] || error?.message || `Could not connect to ${host}:${port}.`);
  (wrapped as any).code = error?.code;
  return wrapped;
}

function buildPrinterJsonFrame({ method, path: commandPath, query = {}, body = {} }: PrinterCommand) {
  if (!method) throw new Error('A request method is required.');
  if (!commandPath || !commandPath.startsWith('/')) throw new Error('A printer API path beginning with / is required.');
  const reserved = new Set(['request_type', 'path']);
  for (const key of [...Object.keys(query), ...Object.keys(body)]) {
    if (reserved.has(key)) throw new Error(`Payload cannot override reserved field "${key}".`);
  }
  return `${JSON.stringify({ request_type: method.toLowerCase(), path: commandPath, ...query, ...body })}\r\n`;
}

function parsePrinterResponse(raw: string) {
  const text = raw.replace(/\0+$/g, '').trim();
  if (!text) return { raw: '', data: null };
  try {
    return { raw: text, data: JSON.parse(text) };
  } catch {
    return { raw: text, data: text };
  }
}

function sendPrinterJsonCommand(command: PrinterCommand): Promise<PrinterCommandResult> {
  const { host, port, timeoutMs } = printerState.config;
  const frame = buildPrinterJsonFrame(command);
  addPrinterLog('out', frame.trimEnd());

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port: Number(port) });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const finish = (error?: any) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        reject(friendlyPrinterNetworkError(error, host, port));
        return;
      }
      const parsed = parsePrinterResponse(Buffer.concat(chunks).toString('utf8'));
      addPrinterLog('in', parsed.raw || '<empty response>');
      resolve({ ...parsed, elapsedMs: Date.now() - started, frame: frame.trimEnd() });
    };

    socket.setTimeout(Number(timeoutMs) || 5000);
    socket.once('connect', () => socket.write(frame, 'utf8'));
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > MAX_PRINTER_RESPONSE_BYTES) {
        finish(new Error('Printer response exceeded 5 MB.'));
        return;
      }
      if (Buffer.concat(chunks).includes(Buffer.from('\r\n'))) finish();
    });
    socket.once('end', () => finish());
    socket.once('close', () => {
      if (!settled && chunks.length) finish();
    });
    socket.once('timeout', () => finish(new Error(`Printer did not respond within ${timeoutMs} ms.`)));
    socket.once('error', finish);
  });
}

function testPrinterTcpConnection() {
  const { host, port, timeoutMs } = printerState.config;
  return new Promise<{ status: string; elapsedMs: number }>((resolve, reject) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port: Number(port) });
    let settled = false;
    const finish = (error?: any) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(friendlyPrinterNetworkError(error, host, port));
      else resolve({ status: 'connected', elapsedMs: Date.now() - started });
    };
    socket.setTimeout(Number(timeoutMs) || 5000);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish(new Error(`Connection timed out after ${timeoutMs} ms.`)));
    socket.once('error', finish);
  });
}

function isPrinterOk(data: any) {
  return data?.status && String(data.status).toLowerCase() !== 'error';
}

function isDangerousPrinterCommand(method: string, commandPath: string) {
  return method === 'DELETE' || /(reset|reboot|update_software|clear_cache|printhead_clear)/i.test(commandPath);
}

function firstNumericValue(source: any, keys: string[], depth = 0): number | null {
  if (!source || typeof source !== 'object' || depth > 3) return null;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
  }
  for (const value of Object.values(source)) {
    if (value && typeof value === 'object') {
      const match = firstNumericValue(value, keys, depth + 1);
      if (match !== null) return match;
    }
  }
  return null;
}

function summarizePrinterQueue(engineData: any) {
  const documentedOutput = firstNumericValue(engineData, ['output']);
  return {
    available: Boolean(engineData && typeof engineData === 'object'),
    queued: firstNumericValue(engineData, ['queue_count', 'queueCount', 'queued', 'cache_count', 'cacheCount', 'recv_ttl']),
    output: documentedOutput,
    processedMaximum: firstNumericValue(engineData, ['process_max', 'processMax', 'processed_maximum', 'processedMaximum']),
    state: engineData?.state ?? null,
    transReady: engineData?.trans_ready ?? engineData?.transReady ?? null,
    dataId: engineData?.data_id ?? engineData?.dataId ?? null,
    dataName: engineData?.data_name ?? engineData?.dataName ?? null,
  };
}

function completePrintJob(job: PrintJob, message: string) {
  job.status = 'completed';
  printerState.totalJobsPrinted++;
  printerState.currentJob = null;
  printerState.queue = printerState.queue.filter((q) => q.id !== job.id);
  printerState.history.unshift(job);
  if (printerState.history.length > 50) printerState.history.pop();
  addPrinterLog('in', message);
}

function failPrintJob(job: PrintJob, error: string) {
  job.status = 'failed';
  job.error = error;
  printerState.currentJob = null;
  printerState.queue = printerState.queue.filter((q) => q.id !== job.id);
  printerState.history.unshift(job);
  if (printerState.history.length > 50) printerState.history.pop();
  addPrinterLog('error', error);
}

async function sendTcpJsonPrintJob(job: PrintJob) {
  const messageName = printerState.config.messageName?.trim();
  const dynamicFieldName = printerState.config.dynamicFieldName?.trim() || 'dynamic_text';

  if (messageName) {
    const start = await sendPrinterJsonCommand({
      method: 'POST',
      path: '/engine/printjob',
      body: {
        hash: crypto.randomInt(1, 2147483647),
        attribute: { print_data_name: messageName },
      },
    });
    const alreadyRunning = String(start.data?.descript || '').toLowerCase().includes('running');
    if (!isPrinterOk(start.data) && !alreadyRunning) {
      throw new Error(start.data?.descript || `Could not start message "${messageName}".`);
    }
  }

  const dynamic = await sendPrinterJsonCommand({
    method: 'POST',
    path: '/engine/dynamic',
    body: {
      print_mode: 'single',
      data: [{ type: 'text', name: dynamicFieldName, content: job.barcodeData }],
    },
  });

  if (!isPrinterOk(dynamic.data)) {
    throw new Error(dynamic.data?.descript || 'Printer rejected dynamic print data.');
  }
}

// Sample simulated barcodes for the Cognex DM 262X
const SAMPLE_CODES: Array<{ data: string; symbology: BarcodeRead['symbology']; grade: BarcodeRead['qualityGrade'] }> = [
  { data: 'DM-9821-X4402', symbology: 'DataMatrix', grade: 'A' },
  { data: 'https://cognex.com/dm262x/sn-5501', symbology: 'QR Code', grade: 'A' },
  { data: 'PKG-2026-88391-B', symbology: 'Code 128', grade: 'A' },
  { data: 'ENG-MTR-772910', symbology: 'DataMatrix', grade: 'B' },
  { data: 'LOT#992019-V', symbology: 'Code 39', grade: 'A' },
  { data: 'GS1-0100850006-21', symbology: 'PDF417', grade: 'A' },
];
let sampleIndex = 0;
const printerRuntimeValues = new Map<string, Record<string, any>>();

const GS1_AI_LABELS: Record<string, string> = {
  '01': 'GTIN',
  '11': 'Manufacturing date',
  '17': 'Expiration date',
  '10': 'Batch / lot',
  '21': 'Serial number',
};

function printerRuntimeKey(messageId: number | string) {
  return String(messageId);
}

function findPrinterSourceRefs(message: any) {
  const refs = new Map<string, any>();
  const visit = (value: any, objectContext: Record<string, any> = {}) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, objectContext));
      return;
    }

    const context = value.id != null && value.type && (value.source_list || value.sourceList)
      ? { objectId: value.id, objectName: value.name, objectType: value.type }
      : objectContext;
    const sourceList = value.source_list || value.sourceList;

    if (Array.isArray(sourceList)) {
      for (const source of sourceList) {
        if (source?.id != null && source?.type) {
          refs.set(`${source.type}:${source.id}`, { ...context, id: source.id, type: source.type, name: source.name });
        }
      }
    }

    for (const child of Object.values(value)) visit(child, context);
  };

  visit(message);
  return [...refs.values()];
}

function isTextPrinterField(type: string) {
  return String(type || '').toLowerCase().includes('text');
}

function gs1IdentifierFromSource(source: any) {
  const configured = source?.attribute?.content ?? source?.attribute?.fill_value ?? '';
  const configuredIdentifier = String(configured).match(/^\((01|11|17|10|21)\)/)?.[1];
  if (configuredIdentifier) return configuredIdentifier;

  const name = String(source?.name || '').toUpperCase();
  if (/GTIN/.test(name)) return '01';
  if (/MFG|MANUFACTUR|PRODUCTION/.test(name)) return '11';
  if (/EXP|EXPIR/.test(name)) return '17';
  if (/BATCH|LOT/.test(name)) return '10';
  if (/SERIAL/.test(name)) return '21';
  return null;
}

function normalizeDynamicContent(type: string, value: unknown, identifier?: string | null) {
  const content = String(value ?? '').trim();
  if (!String(type || '').toLowerCase().includes('gs1')) return content;
  const raw = content.replace(/\((\d{2,4})\)/g, '$1');
  return identifier && !raw.startsWith(identifier) ? `${identifier}${raw}` : raw;
}

async function inspectPrinterFields(messageId: number) {
  const detail = await sendPrinterJsonCommand({
    method: 'GET',
    path: '/data/data',
    query: { id: messageId, detail: 1 },
  });
  if (!isPrinterOk(detail.data)) return { message: detail.data, fields: [] };

  const saved = printerRuntimeValues.get(printerRuntimeKey(messageId)) || {};
  const refs = findPrinterSourceRefs(detail.data);
  const fields = [];

  for (const ref of refs) {
    try {
      const source = await sendPrinterJsonCommand({
        method: 'GET',
        path: '/data/source',
        query: { id: ref.id, type: ref.type },
      });
      const value =
        source.data?.attribute?.content ??
        source.data?.attribute?.current ??
        source.data?.attribute?.value ??
        null;
      const gs1Identifier = gs1IdentifierFromSource(source.data);
      fields.push({
        ...ref,
        name: source.data?.name || ref.name || '',
        value,
        runtimeValue: saved[`${ref.type}:${ref.id}`]?.content ?? null,
        runtimeUpdatedAt: saved[`${ref.type}:${ref.id}`]?.updatedAt ?? null,
        available: isPrinterOk(source.data),
        gs1Identifier,
        gs1Label: gs1Identifier ? GS1_AI_LABELS[gs1Identifier] || 'Unknown GS1 field' : null,
        source: source.data,
      });
    } catch (err: any) {
      fields.push({ ...ref, name: ref.name || '', value: null, available: false, error: err.message });
    }
  }

  return { message: detail.data, fields };
}

async function ensurePrinterMessageRunning(messageId: number | undefined, messageName: string | undefined) {
  const real = await sendPrinterJsonCommand({ method: 'GET', path: '/engine/real' });
  const running = isPrinterOk(real.data) && real.data?.state === 'started';
  if (running && messageId != null && Number(real.data?.data_id) !== Number(messageId)) {
    throw new Error(`The print engine is running ${real.data?.data_name || `message ${real.data?.data_id}`}. Start ${messageName || `message ${messageId}`} before sending fields.`);
  }
  if (running) return real;
  if (!messageName) throw new Error('Select a message before sending dynamic fields.');

  const started = await sendPrinterJsonCommand({
    method: 'POST',
    path: '/engine/printjob',
    body: {
      hash: crypto.randomInt(1, 2147483647),
      attribute: { print_data_name: messageName },
    },
  });
  const alreadyRunning = String(started.data?.descript || '').toLowerCase().includes('running');
  if (!isPrinterOk(started.data) && !alreadyRunning) {
    throw new Error(started.data?.descript || `Could not start ${messageName}.`);
  }
  return started;
}

async function updatePrinterDynamicFields(input: any) {
  const messageId = Number(input.messageId);
  const messageName = String(input.messageName || '');
  const fieldsInput = Array.isArray(input.fields) ? input.fields : [input];
  if (!Number.isInteger(messageId)) throw new Error('messageId is required.');
  if (!fieldsInput.length) throw new Error('At least one field is required.');

  const resolved = [];
  for (const field of fieldsInput) {
    const id = Number(field.fieldId);
    const type = String(field.fieldType || 'text');
    if (!Number.isInteger(id)) throw new Error('Every field must have a numeric field ID.');

    let lookupData: any = null;
    try {
      const lookup = await sendPrinterJsonCommand({
        method: 'GET',
        path: '/data/source',
        query: { id, type },
      });
      if (isPrinterOk(lookup.data)) {
        lookupData = lookup.data;
      } else {
        addPrinterLog('system', `Field lookup ${id} (${type}) returned ${lookup.data?.descript || lookup.raw || 'not ok'}; using saved field metadata.`);
      }
    } catch (err: any) {
      addPrinterLog('system', `Field lookup ${id} (${type}) failed: ${err.message}; using saved field metadata.`);
    }

    const fieldName = field.fieldName || lookupData?.name || '';
    if (!fieldName && isTextPrinterField(type)) {
      throw new Error(`Field ${id} (${type}) is not available on the printer and has no saved field name.`);
    }
    const gs1Identifier = gs1IdentifierFromSource(lookupData || { name: fieldName, attribute: { content: field.value } });
    resolved.push({
      id,
      type,
      name: fieldName,
      gs1Identifier,
      value: normalizeDynamicContent(type, field.value, gs1Identifier),
    });
  }

  const textFields = resolved.filter((field) => isTextPrinterField(field.type));
  const numericFields = resolved.filter((field) => !isTextPrinterField(field.type));
  if (textFields.some((field) => !field.name)) throw new Error('The printer did not return a name for one or more text fields.');
  if (numericFields.some((field) => !Number.isFinite(Number(field.value)))) throw new Error('Non-text fields require numeric values.');

  const posted = [];
  if (textFields.length) {
    await ensurePrinterMessageRunning(messageId, messageName);
    posted.push({
      group: 'text',
      result: await sendPrinterJsonCommand({
        method: 'POST',
        path: '/engine/dynamic',
        body: {
          print_mode: input.printMode || 'single',
          data: textFields.map((field) => ({ type: 'text', name: field.name, content: String(field.value ?? '') })),
        },
      }),
    });
  }
  if (numericFields.length) {
    posted.push({
      group: 'numeric',
      result: await sendPrinterJsonCommand({
        method: 'POST',
        path: '/engine/parm_modify',
        body: {
          cmd: 'up_parm',
          parm: numericFields.map((field) => ({ type: field.type, id: field.id, value: Number(field.value) })),
        },
      }),
    });
  }

  const rejected = posted.find((entry) => !isPrinterOk(entry.result.data));
  if (!rejected) {
    const updatedAt = new Date().toISOString();
    const saved = printerRuntimeValues.get(printerRuntimeKey(messageId)) || {};
    for (const field of resolved) {
      saved[`${field.type}:${field.id}`] = {
        id: field.id,
        type: field.type,
        name: field.name,
        content: String(field.value ?? ''),
        updatedAt,
      };
    }
    printerRuntimeValues.set(printerRuntimeKey(messageId), saved);
  }

  return {
    ok: !rejected,
    updatedCount: rejected ? 0 : resolved.length,
    posted: posted.map((entry) => ({ group: entry.group, response: entry.result.data, elapsedMs: entry.result.elapsedMs })),
    fields: resolved.map((field) => ({
      fieldId: field.id,
      fieldType: field.type,
      fieldName: field.name,
      acceptedValue: String(field.value ?? ''),
    })),
    error: rejected ? rejected.result.data?.descript || 'The printer rejected the dynamic data.' : undefined,
  };
}

// Execute Scan to Print workflow
function processScanToPrint(read: BarcodeRead) {
  if (!pipelineState.enabled || !pipelineState.autoPrintOnRead) {
    return;
  }

  // Filter verification
  if (pipelineState.barcodePrefixFilter && !read.data.startsWith(pipelineState.barcodePrefixFilter)) {
    pipelineState.totalFiltered++;
    addPrinterLog('system', `Filtered barcode "${read.data}" - did not match prefix "${pipelineState.barcodePrefixFilter}"`);
    return;
  }

  if (read.data.length < pipelineState.minBarcodeLength) {
    pipelineState.totalFiltered++;
    addPrinterLog('system', `Filtered barcode "${read.data}" - length < ${pipelineState.minBarcodeLength}`);
    return;
  }

  pipelineState.totalMatches++;

  // Build raw payload from template
  const rawPayload = pipelineState.labelTemplate
    .replace(/{BARCODE}/g, read.data)
    .replace(/{TIMESTAMP}/g, new Date(read.timestamp).toLocaleTimeString())
    .replace(/{DATE}/g, new Date(read.timestamp).toLocaleDateString())
    .replace(/{OPERATOR}/g, pipelineState.operatorId)
    .replace(/{QUALITY}/g, read.qualityGrade || 'A')
    .replace(/{DECODE_TIME}/g, read.decodeTimeMs.toString());

  const job: PrintJob = {
    id: 'job_' + Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
    barcodeData: read.data,
    title: `Auto-Print: ${read.data}`,
    rawPayload,
    status: 'queued',
    source: 'auto_scan',
  };

  dispatchPrintJob(job);
}

// Dispatch job to printer (TCP or Simulator)
async function dispatchPrintJob(job: PrintJob) {
  printerState.queue.push(job);
  addPrinterLog('out', `Queued print job [${job.id}] for barcode: ${job.barcodeData}`);

  if (printerState.status !== 'connected') {
    addPrinterLog('error', `Cannot print job [${job.id}]: Printer not connected`);
    job.status = 'failed';
    job.error = 'Printer not connected';
    return;
  }

  job.status = 'printing';
  printerState.currentJob = job;

  if (printerState.config.isSimulated) {
    // Simulator processing delay
    setTimeout(() => {
      completePrintJob(job, `[Simulator] Job ${job.id} printed successfully (${job.rawPayload.length} bytes dispatched to thermal engine)`);
    }, 850);
  } else if (printerState.config.protocol === 'TCP_JSON') {
    try {
      await sendTcpJsonPrintJob(job);
      completePrintJob(job, `Accepted dynamic print job ${job.id} through TCP-JSON (${printerState.config.host}:${printerState.config.port})`);
    } catch (err: any) {
      failPrintJob(job, `TCP-JSON print failed for job ${job.id}: ${err.message}`);
    }
  } else {
    // Send over real TCP socket
    try {
      if (!printerSocket) throw new Error('Raw printer socket is not connected');
      printerSocket.write(job.rawPayload + '\n', (err) => {
        if (err) {
          failPrintJob(job, `Socket write error for job ${job.id}: ${err.message}`);
        } else {
          completePrintJob(job, `Dispatched ${job.rawPayload.length} bytes to ${printerState.config.host}:${printerState.config.port}`);
        }
      });
    } catch (err: any) {
      failPrintJob(job, `Exception sending to printer: ${err.message}`);
    }
  }
}

function decodeTelnetData(socket: net.Socket, chunk: Buffer) {
  const input = Buffer.concat([cognexTelnetBuffer, chunk]);
  const output: number[] = [];
  let index = 0;

  while (index < input.length) {
    if (input[index] !== 255) {
      output.push(input[index]);
      index += 1;
      continue;
    }

    if (index + 1 >= input.length) break;
    const command = input[index + 1];

    if (command === 255) {
      output.push(255);
      index += 2;
      continue;
    }

    if ([251, 252, 253, 254].includes(command)) {
      if (index + 2 >= input.length) break;
      const option = input[index + 2];
      if (command === 251) socket.write(Buffer.from([255, 254, option])); // WILL -> DONT
      if (command === 253) socket.write(Buffer.from([255, 252, option])); // DO -> WONT
      index += 3;
      continue;
    }

    if (command === 250) {
      let end = index + 2;
      while (end + 1 < input.length && !(input[end] === 255 && input[end + 1] === 240)) end += 1;
      if (end + 1 >= input.length) break;
      index = end + 2;
      continue;
    }

    index += 2;
  }

  cognexTelnetBuffer = index < input.length ? input.subarray(index) : Buffer.alloc(0);
  return Buffer.from(output).toString('utf8');
}

function isCognexProtocolLine(line: string) {
  const value = line.toLowerCase();
  return line.startsWith('<||')
    || line.startsWith('||>')
    || value.includes('login:')
    || value.includes('username:')
    || value.includes('password:')
    || value.includes('login succeeded')
    || value.includes('welcome to cognex')
    || value.includes('welcome to dataman');
}

function processCognexLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || isCognexProtocolLine(trimmed)) return;

  if (/^no\s*read$/i.test(trimmed)) {
    cognexState.noReads++;
    return;
  }

  if (pendingCognexCommand) {
    addCognexLog('system', `DMCC response for ${pendingCognexCommand}: ${trimmed}`);
    pendingCognexCommand = null;
    return;
  }

  const scannedCode = normalizeScannedCode(trimmed);
  if (!scannedCode) return;
  const read: BarcodeRead = {
    id: 'read_' + Math.random().toString(36).substring(2, 9),
    data: scannedCode,
    symbology: scannedCode.length > 20 ? 'PDF417' : scannedCode.includes('-') ? 'DataMatrix' : 'Code 128',
    timestamp: Date.now(),
    decodeTimeMs: Math.floor(Math.random() * 15) + 12,
    qualityGrade: 'A',
    rawBuffer: trimmed,
  };
  cognexState.lastRead = read;
  cognexState.readHistory.unshift(read);
  if (cognexState.readHistory.length > 50) cognexState.readHistory.pop();
  cognexState.goodReads++;

  queueRecipeCodeScan(trimmed);
}

// Connect Cognex
function connectCognex(config: typeof cognexState.config) {
  cognexState.config = { ...config };
  cognexState.status = 'connecting';
  addCognexLog('system', `Attempting Telnet connection to Cognex DM 262X at ${config.host}:${config.port}...`);

  if (config.isSimulated) {
    setTimeout(() => {
      cognexState.status = 'connected';
      cognexState.error = undefined;
      addCognexLog('in', `Connected to Simulated Cognex DataMan 262X [${config.host}:${config.port}]`);
      addCognexLog('in', `Cognex DMCC Engine ready: send ||>trigger on\\r\\n to read.`);
    }, 600);
    return;
  }

  // Real TCP/Telnet connection
  try {
    if (cognexSocket) {
      cognexSocket.destroy();
      cognexSocket = null;
    }

    const socket = new net.Socket();
    cognexSocket = socket;
    cognexTelnetBuffer = Buffer.alloc(0);
    cognexLineBuffer = '';
    if (cognexLineFlushTimer) clearTimeout(cognexLineFlushTimer);
    cognexLineFlushTimer = null;
    pendingCognexCommand = null;

    socket.setTimeout(config.timeoutMs || 5000);

    socket.connect(config.port, config.host, () => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, 10000);
      cognexState.status = 'connected';
      cognexState.error = undefined;
      cognexState.ipAddress = config.host;
      addCognexLog('system', `Telnet connection established to ${config.host}:${config.port}`);
    });

    socket.on('data', (data) => {
      const text = decodeTelnetData(socket, data);
      if (!text) return;
      addCognexLog('in', text.trim());

      if (/(?:login|username|user):\s*$/i.test(text) && config.user) {
        socket.write(`${config.user}\r\n`);
        addCognexLog('system', 'Telnet username supplied after login prompt.');
      } else if (/password:\s*$/i.test(text)) {
        socket.write(`${config.password || ''}\r\n`);
        addCognexLog('system', 'Telnet password supplied after password prompt.');
      }

      // Parse DMCC or Raw Barcode string
      cognexLineBuffer += text;
      const parts = cognexLineBuffer.split(/[\r\n]+/);
      cognexLineBuffer = /[\r\n]$/.test(cognexLineBuffer) ? '' : (parts.pop() || '');
      const lines = parts.filter((line) => line.trim().length > 0);
      for (const line of lines) processCognexLine(line);

      if (cognexLineFlushTimer) clearTimeout(cognexLineFlushTimer);
      cognexLineFlushTimer = cognexLineBuffer
        ? setTimeout(() => {
            const pendingLine = cognexLineBuffer;
            cognexLineBuffer = '';
            cognexLineFlushTimer = null;
            processCognexLine(pendingLine);
          }, 40)
        : null;
    });

    socket.on('error', (err) => {
      if (cognexSocket !== socket) return;
      cognexState.status = 'error';
      cognexState.error = err.message;
      addCognexLog('error', `Telnet socket error: ${err.message}`);
    });

    socket.on('close', () => {
      if (cognexSocket !== socket) return;
      cognexState.status = 'disconnected';
      addCognexLog('system', `Cognex Telnet socket closed`);
      cognexSocket = null;
    });

    socket.on('timeout', () => {
      if (cognexSocket !== socket) return;
      cognexState.status = 'error';
      cognexState.error = 'Connection timed out';
      addCognexLog('error', `Connection to ${config.host}:${config.port} timed out`);
      socket.destroy();
    });
  } catch (err: any) {
    cognexState.status = 'error';
    cognexState.error = err.message;
    addCognexLog('error', `Failed to initialize Telnet client: ${err.message}`);
  }
}

function disconnectCognex() {
  if (cognexLineFlushTimer) {
    clearTimeout(cognexLineFlushTimer);
    cognexLineFlushTimer = null;
  }
  cognexLineBuffer = '';
  if (cognexSocket) {
    cognexSocket.destroy();
    cognexSocket = null;
  }
  cognexState.status = 'disconnected';
  addCognexLog('system', 'Cognex Telnet disconnected by operator.');
}

// Trigger Cognex
function triggerCognex() {
  const socket = cognexSocket;
  if (!cognexState.config.isSimulated && (!socket || cognexState.status !== 'connected')) {
    throw new Error('Cognex Telnet is not connected. Connect the camera before triggering.');
  }

  cognexState.totalTriggers++;
  addCognexLog('out', '||>trigger on\r\n', true);

  if (cognexState.config.isSimulated) {
    // Generate simulated read
    const sample = SAMPLE_CODES[sampleIndex % SAMPLE_CODES.length];
    sampleIndex++;

    const decodeTime = Math.floor(Math.random() * 20) + 14;
    setTimeout(() => {
      addCognexLog('in', `<||[trigger on 1]\r\n`, true);
      addCognexLog('in', sample.data);

      const read: BarcodeRead = {
        id: 'read_' + Math.random().toString(36).substring(2, 9),
        data: sample.data,
        symbology: sample.symbology,
        timestamp: Date.now(),
        decodeTimeMs: decodeTime,
        qualityGrade: sample.grade,
      };

      cognexState.lastRead = read;
      cognexState.readHistory.unshift(read);
      if (cognexState.readHistory.length > 50) cognexState.readHistory.pop();
      cognexState.goodReads++;

      // Camera reads are intentionally kept separate from printer dispatch.
    }, decodeTime + 30);
  } else {
    try {
      socket!.write('||>trigger on\r\n');
    } catch (err: any) {
      addCognexLog('error', `Failed to write trigger command: ${err.message}`);
    }
  }
}

// Connect Printer
async function connectPrinter(config: typeof printerState.config) {
  printerState.config = { ...config };
  printerState.status = 'connecting';
  addPrinterLog('system', `Connecting to printer socket at ${config.host}:${config.port} (${config.protocol})...`);

  if (config.isSimulated) {
    setTimeout(() => {
      printerState.status = 'connected';
      printerState.error = undefined;
      addPrinterLog('in', `Connected to Simulated Thermal Printer at ${config.host}:${config.port}`);
      addPrinterLog('in', `Host status: HEAD CLOSED, PAPER OK, READY (300 DPI)`);
    }, 600);
    return;
  }

  if (config.protocol === 'TCP_JSON') {
    try {
      const connection = await testPrinterTcpConnection();
      printerState.status = 'connected';
      printerState.error = undefined;
      addPrinterLog('in', `TCP connection established in ${connection.elapsedMs} ms`);
      const heartbeat = await sendPrinterJsonCommand({ method: 'GET', path: '/info/heart_beat' });
      if (!isPrinterOk(heartbeat.data)) {
        throw new Error(heartbeat.data?.descript || 'Heartbeat returned an error response.');
      }
      addPrinterLog('system', 'Heartbeat OK');
    } catch (err: any) {
      printerState.status = 'error';
      printerState.error = err.message;
      addPrinterLog('error', err.message);
    }
    return;
  }

  try {
    if (printerSocket) {
      printerSocket.destroy();
      printerSocket = null;
    }

    const socket = new net.Socket();
    printerSocket = socket;
    socket.setTimeout(config.timeoutMs || 5000);

    socket.connect(config.port, config.host, () => {
      printerState.status = 'connected';
      printerState.error = undefined;
      addPrinterLog('in', `Connected to Printer TCP Socket at ${config.host}:${config.port}`);
      // Send host status check for ZPL
      if (config.protocol === 'ZPL') {
        socket.write('~HS\r\n');
      }
    });

    socket.on('data', (data) => {
      const text = data.toString('utf8');
      addPrinterLog('in', text.trim());
    });

    socket.on('error', (err) => {
      printerState.status = 'error';
      printerState.error = err.message;
      addPrinterLog('error', `Printer socket error: ${err.message}`);
    });

    socket.on('close', () => {
      printerState.status = 'disconnected';
      addPrinterLog('system', 'Printer socket closed');
      printerSocket = null;
    });

    socket.on('timeout', () => {
      printerState.status = 'error';
      printerState.error = 'Connection timed out';
      addPrinterLog('error', `Printer socket connection timed out`);
      socket.destroy();
    });
  } catch (err: any) {
    printerState.status = 'error';
    printerState.error = err.message;
    addPrinterLog('error', `Failed to initialize printer socket: ${err.message}`);
  }
}

function disconnectPrinter() {
  if (printerSocket) {
    printerSocket.destroy();
    printerSocket = null;
  }
  printerState.status = 'disconnected';
  addPrinterLog('system', 'Printer disconnected by operator.');
}

// ---------------- API ROUTES ----------------

app.get('/api/system/state', (req, res) => {
  const state: SystemState = {
    cognex: cognexState,
    printer: printerState,
    pipeline: pipelineState,
  };
  res.json(state);
});

// Cognex routes
app.post('/api/cognex/connect', (req, res) => {
  const { host, port, user, password, isSimulated, timeoutMs } = req.body;
  connectCognex({
    ...cognexState.config,
    host: host || cognexState.config.host,
    port: Number(port) || cognexState.config.port,
    user: user !== undefined ? user : cognexState.config.user,
    password: password !== undefined ? password : cognexState.config.password,
    isSimulated: isSimulated !== undefined ? Boolean(isSimulated) : cognexState.config.isSimulated,
    timeoutMs: Number(timeoutMs) || 5000,
  });
  res.json({ success: true, status: cognexState.status });
});

app.post('/api/cognex/disconnect', (req, res) => {
  disconnectCognex();
  res.json({ success: true, status: cognexState.status });
});

app.post('/api/cognex/trigger', (req, res) => {
  try {
    triggerCognex();
    res.json({ success: true, totalTriggers: cognexState.totalTriggers });
  } catch (err: any) {
    addCognexLog('error', err.message);
    res.status(409).json({ success: false, error: err.message });
  }
});

app.post('/api/cognex/send', (req, res) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  const cleanCmd = command.endsWith('\n') ? command : command + '\r\n';
  addCognexLog('out', cleanCmd, cleanCmd.startsWith('||>'));

  const socket = cognexSocket;
  if (!cognexState.config.isSimulated && (!socket || cognexState.status !== 'connected')) {
    const error = 'Cognex Telnet is not connected. Connect the camera before sending commands.';
    addCognexLog('error', error);
    return res.status(409).json({ success: false, error });
  }

  if (cognexState.config.isSimulated) {
    // Simulator command parser
    const cmdUpper = cleanCmd.toUpperCase();
    setTimeout(() => {
      if (cmdUpper.includes('TRIGGER ON')) {
        triggerCognex();
      } else if (cmdUpper.includes('GET DEVICE.NAME')) {
        addCognexLog('in', `<||[get device.name "${cognexState.deviceName}"]\r\n`, true);
      } else if (cmdUpper.includes('GET SYSTEM.SERIAL-NUMBER') || cmdUpper.includes('SERIAL')) {
        addCognexLog('in', `<||[get system.serial-number "${cognexState.serialNumber}"]\r\n`, true);
      } else if (cmdUpper.includes('GET CAMERA.EXPOSURE') || cmdUpper.includes('EXPOSURE')) {
        addCognexLog('in', `<||[get camera.exposure ${cognexState.exposureUs}]\r\n`, true);
      } else if (cmdUpper.includes('SET CAMERA.EXPOSURE')) {
        const val = parseInt(cleanCmd.replace(/[^0-9]/g, '')) || 1500;
        cognexState.exposureUs = val;
        addCognexLog('in', `<||[set camera.exposure ${val} 1]\r\n`, true);
      } else if (cmdUpper.includes('BEEP')) {
        addCognexLog('in', `<||[beep 1]\r\n`, true);
      } else {
        addCognexLog('in', `<||[${cleanCmd.replace(/[\r\n]/g, '')} OK]\r\n`, true);
      }
    }, 150);
  } else {
    try {
      if (!/^\|\|>\s*trigger\b/i.test(cleanCmd)) {
        pendingCognexCommand = cleanCmd.replace(/[\r\n]/g, '').replace(/^\|\|>\s*/, '');
      }
      socket!.write(cleanCmd);
    } catch (err: any) {
      addCognexLog('error', `Failed to send command: ${err.message}`);
    }
  }

  res.json({ success: true });
});

app.post('/api/cognex/config', (req, res) => {
  cognexState.config = { ...cognexState.config, ...req.body };
  res.json({ success: true, config: cognexState.config });
});

app.get('/api/cognex/images', (req, res) => {
  try {
    const value = listCognexImages(Number(req.query.limit || 25));
    res.json({ ok: true, ...value, latest: value.images[0] || null });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/cognex/latest-image', (req, res) => {
  try {
    const value = listCognexImages(1);
    const latest = value.images[0];
    if (!latest) {
      res.status(404).json({ ok: false, error: 'No Cognex FTP image found.' });
      return;
    }
    res.sendFile(resolveCognexImagePath(latest.filename));
  } catch (err: any) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

app.get('/api/cognex/image/:filename', (req, res) => {
  try {
    res.sendFile(resolveCognexImagePath(req.params.filename));
  } catch (err: any) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

// Printer routes
app.post('/api/printer/connect', async (req, res) => {
  const { host, port, protocol, isSimulated, timeoutMs, messageName, dynamicFieldName } = req.body;
  await connectPrinter({
    ...printerState.config,
    host: host || printerState.config.host,
    port: Number(port) || printerState.config.port,
    protocol: protocol || printerState.config.protocol,
    isSimulated: isSimulated !== undefined ? Boolean(isSimulated) : printerState.config.isSimulated,
    timeoutMs: Number(timeoutMs) || 5000,
    messageName: messageName !== undefined ? messageName : printerState.config.messageName,
    dynamicFieldName: dynamicFieldName !== undefined ? dynamicFieldName : printerState.config.dynamicFieldName,
  });
  res.json({ success: true, status: printerState.status });
});

app.post('/api/printer/disconnect', (req, res) => {
  disconnectPrinter();
  res.json({ success: true, status: printerState.status });
});

app.post('/api/printer/print', async (req, res) => {
  const { barcodeData, title, rawPayload } = req.body;
  const payload = rawPayload || barcodeData || 'MANUAL-DATA';

  const job: PrintJob = {
    id: 'job_' + Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
    barcodeData: barcodeData || 'MANUAL-DATA',
    title: title || 'Manual Print Job',
    rawPayload: payload,
    status: 'queued',
    source: 'manual',
  };

  await dispatchPrintJob(job);
  res.json({ success: true, job });
});

app.post('/api/printer/test-print', async (req, res) => {
  const testPayload = 'TEST-LABEL-12345';

  const job: PrintJob = {
    id: 'job_test_' + Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
    barcodeData: 'TEST-LABEL-12345',
    title: 'Test Calibration Label',
    rawPayload: testPayload,
    status: 'queued',
    source: 'test_print',
  };

  await dispatchPrintJob(job);
  res.json({ success: true, job });
});

app.post('/api/printer/config', (req, res) => {
  printerState.config = { ...printerState.config, ...req.body };
  res.json({ success: true, config: printerState.config });
});

app.get('/api/printer/status', async (req, res) => {
  try {
    const [heartbeat, engine, system] = await Promise.all([
      sendPrinterJsonCommand({ method: 'GET', path: '/info/heart_beat' }),
      sendPrinterJsonCommand({ method: 'GET', path: '/engine/real' }),
      sendPrinterJsonCommand({ method: 'GET', path: '/info/status' }),
    ]);
    printerState.status = isPrinterOk(heartbeat.data) ? 'connected' : 'error';
    printerState.error = printerState.status === 'error' ? heartbeat.data?.descript || 'Heartbeat failed' : undefined;
    res.json({
      ok: printerState.status === 'connected',
      heartbeat: heartbeat.data,
      engine: engine.data,
      queue: summarizePrinterQueue(engine.data),
      system: system.data,
    });
  } catch (err: any) {
    printerState.status = 'error';
    printerState.error = err.message;
    addPrinterLog('error', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/printer/messages', async (req, res) => {
  try {
    const offset = Number(req.query.offset || 0);
    const num = Math.min(100, Number(req.query.num || 25));
    const result = await sendPrinterJsonCommand({ method: 'GET', path: '/data/list', query: { offset, num } });
    res.json({ ok: isPrinterOk(result.data), data: result.data, raw: result.raw });
  } catch (err: any) {
    addPrinterLog('error', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/printer/fields', async (req, res) => {
  try {
    const messageId = Number(req.query.messageId);
    if (!Number.isInteger(messageId)) {
      res.status(400).json({ ok: false, error: 'messageId is required.' });
      return;
    }
    const inspected = await inspectPrinterFields(messageId);
    res.json({ ok: true, ...inspected });
  } catch (err: any) {
    addPrinterLog('error', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.post('/api/printer/dynamic', async (req, res) => {
  try {
    const result = await updatePrinterDynamicFields(req.body);
    res.json(result);
  } catch (err: any) {
    addPrinterLog('error', err.message);
    res.status(err.statusCode || 502).json({ ok: false, error: err.message });
  }
});

app.get('/api/printer/recipes', async (req, res) => {
  try {
    const messageId = req.query.messageId !== undefined ? Number(req.query.messageId) : undefined;
    const recipes = await listRecipes(messageId);
    res.json({ ok: true, recipes });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/printer/recipes/:id', async (req, res) => {
  try {
    const recipe = await readRecipe(Number(req.params.id));
    if (!recipe) {
      res.status(404).json({ ok: false, error: 'Recipe not found.' });
      return;
    }
    res.json({ ok: true, recipe });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/printer/recipes', async (req, res) => {
  try {
    const recipe = await saveRecipe(req.body);
    res.status(201).json({ ok: true, recipe });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put('/api/printer/recipes/:id', async (req, res) => {
  try {
    const recipe = await saveRecipe(req.body, Number(req.params.id));
    res.json({ ok: true, recipe });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/printer/recipes/:id', async (req, res) => {
  try {
    await ensureRecipeSchema();
    const pool = getMysqlPool();
    await pool.query('DELETE FROM printer_recipes WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/printer/recipes/:id/apply', async (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    const recipe = await readRecipe(recipeId);
    if (!recipe) {
      res.status(404).json({ ok: false, error: 'Recipe not found.' });
      return;
    }

    const fieldOverrides = req.body?.fieldOverrides || {};
    const generatedSerial = recipe.fields.some((field: any) => field.mode === 'serial')
      ? await createRecipeSerial(recipe, undefined, fieldOverrides)
      : null;
    if (generatedSerial) {
      const pool = getMysqlPool();
      await pool.query(
        "UPDATE printer_recipe_serials SET print_status = 'printing_pending' WHERE id = ?",
        [generatedSerial.id],
      );
      generatedSerial.printStatus = 'printing_pending';
    }

    const fields = buildRecipePrintFields(recipe, generatedSerial?.serialValue || '', fieldOverrides);

    const result = await updatePrinterDynamicFields({
      messageId: recipe.messageId,
      messageName: recipe.messageName,
      printMode: req.body?.printMode || 'single',
      fields,
    });

    if (result.ok) {
      const pool = getMysqlPool();
      await pool.query('UPDATE printer_recipes SET is_active = 0');
      await pool.query('UPDATE printer_recipes SET is_active = 1 WHERE id = ?', [recipeId]);
      if (generatedSerial) {
        await pool.query(
          "UPDATE printer_recipe_serials SET print_status = 'printed', printer_response = ?, printed_at = CURRENT_TIMESTAMP WHERE id = ?",
          [JSON.stringify(result), generatedSerial.id],
        );
      }
      printerState.config.messageName = recipe.messageName;
      printerState.config.dynamicFieldName = recipe.fields.find((field: any) => field.mode === 'serial')?.fieldName || printerState.config.dynamicFieldName;
    } else if (generatedSerial) {
      const pool = getMysqlPool();
      await pool.query(
        "UPDATE printer_recipe_serials SET print_status = 'failed', printer_response = ?, error_message = ? WHERE id = ?",
        [JSON.stringify(result), result.error || 'Printer rejected recipe fields.', generatedSerial.id],
      );
    }

    res.json({ ok: result.ok, recipeId, generatedSerial, sentFields: fields, result });
  } catch (err: any) {
    addPrinterLog('error', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.post('/api/printer/recipes/:id/select', async (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    const recipe = await readRecipe(recipeId);
    if (!recipe) {
      res.status(404).json({ ok: false, error: 'Recipe not found.' });
      return;
    }

    const pool = getMysqlPool();
    await pool.query('UPDATE printer_recipes SET is_active = 0');
    await pool.query('UPDATE printer_recipes SET is_active = 1 WHERE id = ?', [recipeId]);
    printerState.config.messageName = recipe.messageName;
    printerState.config.dynamicFieldName = recipe.fields.find((field: any) => field.mode === 'serial')?.fieldName || printerState.config.dynamicFieldName;

    const fields = buildRecipeSelectionFields(recipe, req.body?.fieldOverrides || {});
    let result = null;
    if (fields.length && req.body?.sendToPrinter !== false) {
      result = await updatePrinterDynamicFields({
        messageId: recipe.messageId,
        messageName: recipe.messageName,
        printMode: req.body?.printMode || 'single',
        fields,
      });
    }

    res.json({
      ok: !result || result.ok,
      recipeId,
      selectedFields: fields,
      result,
      note: fields.length
        ? 'Selected recipe fields were sent without generating a serial.'
        : 'Recipe selected. No non-serial fields were available to send.',
    });
  } catch (err: any) {
    addPrinterLog('error', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/printer/recipes/:id/serials', async (req, res) => {
  try {
    const rows = await listRecipeSerials(Number(req.params.id), Number(req.query.limit || 100));
    res.json({ ok: true, serials: rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/printer/recipes/:id/generate-batch', async (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    const quantity = Math.min(1000, Math.max(1, Number(req.body?.quantity || 1)));
    const recipe = await readRecipe(recipeId);
    if (!recipe) {
      res.status(404).json({ ok: false, error: 'Recipe not found.' });
      return;
    }
    const serials = [];
    for (let index = 0; index < quantity; index += 1) {
      serials.push(await createRecipeSerial(recipe, undefined, req.body?.fieldOverrides || {}));
    }
    res.json({
      ok: true,
      recipeId,
      generated: serials.length,
      serials,
      method: 'Serial = trailing GTIN digits + numeric SHA-256(UUID + GTIN part) suffix, trimmed to recipe serial length.',
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/printer/recipes/:id/print-batch', async (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    const quantity = Math.min(500, Math.max(1, Number(req.body?.quantity || 1)));
    const recipe = await readRecipe(recipeId);
    if (!recipe) {
      res.status(404).json({ ok: false, error: 'Recipe not found.' });
      return;
    }
    const pool = getMysqlPool();
    const results = [];
    const useExistingOnly = req.body?.useExistingOnly === true;

    const [existingGenerated] = await pool.query<any[]>(
      `SELECT
        id,
        serial_value AS serialValue,
        uuid_value AS uuid,
        gtin_part AS gtinPart,
        complete_code AS completeCode,
        print_status AS printStatus,
        verification_status AS verificationStatus
      FROM printer_recipe_serials
      WHERE recipe_id = ? AND print_status = 'generated'
      ORDER BY id
      LIMIT ?`,
      [recipeId, quantity],
    );
    const serialsToPrint = [...existingGenerated];
    while (!useExistingOnly && serialsToPrint.length < quantity) {
      serialsToPrint.push(await createRecipeSerial(recipe, undefined, req.body?.fieldOverrides || {}));
    }
    if (useExistingOnly && serialsToPrint.length < quantity) {
      addPrinterLog('system', `Only ${serialsToPrint.length} generated serials available for recipe ${recipeId}; not generating new serials because useExistingOnly=true.`);
    }

    for (const serial of serialsToPrint) {
      const completeCode = buildCompleteRecipeCode(recipe, serial.serialValue, req.body?.fieldOverrides || {});
      await pool.query(
        "UPDATE printer_recipe_serials SET complete_code = ?, print_status = 'printing_pending' WHERE id = ?",
        [completeCode, serial.id],
      );

      const fields = buildRecipePrintFields(recipe, serial.serialValue, req.body?.fieldOverrides || {});
      try {
        const result = await updatePrinterDynamicFields({
          messageId: recipe.messageId,
          messageName: recipe.messageName,
          printMode: req.body?.printMode || 'single',
          fields,
        });
        if (result.ok) {
          await pool.query(
            "UPDATE printer_recipe_serials SET print_status = 'printed', printer_response = ?, printed_at = CURRENT_TIMESTAMP WHERE id = ?",
            [JSON.stringify(result), serial.id],
          );
        } else {
          await pool.query(
            "UPDATE printer_recipe_serials SET print_status = 'failed', printer_response = ?, error_message = ? WHERE id = ?",
            [JSON.stringify(result), result.error || 'Printer rejected recipe fields.', serial.id],
          );
        }
        results.push({ serialId: serial.id, serialValue: serial.serialValue, completeCode, ok: result.ok, result });
      } catch (error: any) {
        await pool.query(
          "UPDATE printer_recipe_serials SET print_status = 'failed', error_message = ? WHERE id = ?",
          [error.message, serial.id],
        );
        results.push({ serialId: serial.id, serialValue: serial.serialValue, completeCode, ok: false, error: error.message });
      }
    }

    await pool.query('UPDATE printer_recipes SET is_active = 0');
    await pool.query('UPDATE printer_recipes SET is_active = 1 WHERE id = ?', [recipeId]);
    printerState.config.messageName = recipe.messageName;
    printerState.config.dynamicFieldName = recipe.fields.find((field: any) => field.mode === 'serial')?.fieldName || printerState.config.dynamicFieldName;

    res.json({
      ok: results.every((result) => result.ok),
      recipeId,
      requested: quantity,
      usedExistingOnly: useExistingOnly,
      printed: results.filter((result) => result.ok).length,
      results,
    });
  } catch (err: any) {
    addPrinterLog('error', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.post('/api/printer/command', async (req, res) => {
  try {
    const method = String(req.body.method || 'GET').toUpperCase();
    const commandPath = String(req.body.path || '');
    if (isDangerousPrinterCommand(method, commandPath) && req.body.confirmDangerous !== true) {
      res.status(409).json({
        ok: false,
        confirmationRequired: true,
        error: 'This command can change printer state. Confirm it before sending.',
      });
      return;
    }
    const result = await sendPrinterJsonCommand({
      method,
      path: commandPath,
      query: req.body.query || {},
      body: req.body.body || {},
    });
    res.json({ ok: isPrinterOk(result.data), data: result.data, raw: result.raw, elapsedMs: result.elapsedMs });
  } catch (err: any) {
    addPrinterLog('error', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Pipeline routes
app.post('/api/pipeline/config', (req, res) => {
  pipelineState = { ...pipelineState, ...req.body, autoPrintOnRead: false };
  res.json({ success: true, pipeline: pipelineState });
});

app.post('/api/logs/clear', (req, res) => {
  const { target } = req.body;
  if (target === 'cognex' || target === 'all') {
    cognexState.logs = [];
  }
  if (target === 'printer' || target === 'all') {
    printerState.logs = [];
  }
  res.json({ success: true });
});

// ---------------- SERVER BOOTSTRAP ----------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cognex & Printer Controller running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
