export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface CognexConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  timeoutMs: number;
  isSimulated: boolean;
  autoReconnect: boolean;
  ftpImageDirectory?: string;
}

export interface BarcodeRead {
  id: string;
  data: string;
  symbology: 'DataMatrix' | 'QR Code' | 'Code 128' | 'Code 39' | 'PDF417' | 'EAN-13';
  timestamp: number;
  decodeTimeMs: number;
  qualityGrade?: 'A' | 'B' | 'C' | 'D' | 'F';
  rawBuffer?: string;
  printed?: boolean;
}

export interface TelnetLogEntry {
  id: string;
  timestamp: number;
  direction: 'in' | 'out' | 'system' | 'error';
  message: string;
  isDmcc?: boolean;
}

export interface CognexDeviceState {
  status: ConnectionStatus;
  config: CognexConfig;
  error?: string;
  deviceName: string;
  serialNumber: string;
  firmware: string;
  ipAddress: string;
  macAddress: string;
  lastRead: BarcodeRead | null;
  readHistory: BarcodeRead[];
  exposureUs: number;
  gain: number;
  focusPosition: number;
  logs: TelnetLogEntry[];
  totalTriggers: number;
  goodReads: number;
  noReads: number;
}

export type PrinterProtocol = 'TCP_JSON' | 'ZPL' | 'ESC-POS' | 'RAW_TEXT';

export interface PrinterConfig {
  host: string;
  port: number;
  protocol: PrinterProtocol;
  timeoutMs: number;
  isSimulated: boolean;
  autoReconnect: boolean;
  labelWidthMm: number;
  labelHeightMm: number;
  dpi: 203 | 300 | 600;
  messageName?: string;
  dynamicFieldName?: string;
}

export interface PrintJob {
  id: string;
  timestamp: number;
  barcodeData: string;
  title: string;
  rawPayload: string;
  status: 'queued' | 'printing' | 'completed' | 'failed';
  error?: string;
  source: 'auto_scan' | 'manual' | 'test_print';
}

export interface PrinterDeviceState {
  status: ConnectionStatus;
  config: PrinterConfig;
  error?: string;
  printerModel: string;
  isHeadOpen: boolean;
  isPaperOut: boolean;
  isPaused: boolean;
  currentJob: PrintJob | null;
  queue: PrintJob[];
  history: PrintJob[];
  logs: TelnetLogEntry[];
  totalJobsPrinted: number;
}

export interface ScanToPrintPipeline {
  enabled: boolean;
  autoPrintOnRead: boolean;
  barcodePrefixFilter: string;
  minBarcodeLength: number;
  labelTemplate: string;
  partNumberPrefix: string;
  operatorId: string;
  soundEnabled: boolean;
  totalMatches: number;
  totalFiltered: number;
}

export interface SystemState {
  cognex: CognexDeviceState;
  printer: PrinterDeviceState;
  pipeline: ScanToPrintPipeline;
}
