# TrackForge

TrackForge is an industrial track-and-trace control platform that connects Cognex DataMan barcode readers with network label printers. It provides one browser-based workspace for device control, serialized-code generation, label printing, scan verification, recipe management, and production monitoring.

The application can communicate with physical equipment or run in simulation mode, making it useful for production operations, integration testing, demonstrations, and operator training.

## Key features

- **Cognex camera control** — connect to a Cognex DataMan 262X over Telnet, trigger reads, send DMCC commands, and inspect device activity.
- **Network printer control** — connect to industrial printers and send jobs using TCP-JSON, ZPL II, or raw text workflows.
- **Track-and-trace workflow** — generate unique serialized codes, print labels, scan the finished codes, and record their print and verification states.
- **Printer recipe management** — discover printer messages and dynamic fields, create reusable recipes, and assign fixed, recipe-level, or serialized values.
- **Batch printing** — generate and print controlled batches of serialized labels.
- **Continuous printing** — run rate-limited print jobs, view live progress, and stop an active job safely.
- **Barcode verification** — match camera reads against generated codes and update their verification status.
- **Image monitoring** — display the latest image uploaded by the Cognex image/FTP logging workflow.
- **Live operational status** — monitor camera and printer connections, recent reads, print counts, alerts, and communication logs.
- **Hardware simulation** — exercise the user interface and workflows without requiring a connected camera or printer.
- **Persistent configuration** — store device settings, printer recipes, recipe fields, and serialization records in MySQL.
- **Operator feedback** — audible scan/print notifications, label previews, status badges, and searchable history help operators see what the system is doing.

## Good uses for TrackForge

TrackForge is well suited to:

- Pharmaceutical serialization and packaging-line prototyping
- Product, carton, and pallet identification workflows
- Printing and verifying Data Matrix or barcode labels
- Testing camera-to-printer integrations before factory deployment
- Validating printer messages and dynamic-field mappings
- Generating controlled serial-number batches
- Demonstrating track-and-trace workflows to operators and stakeholders
- Training operators without using production hardware or consumables
- Troubleshooting device communication through a shared log view

> TrackForge is an integration and operations tool. Validate the complete installation, printer output, code quality, database controls, user access, backups, and regulatory requirements before using it in a regulated production environment.

## How it works

```text
Recipe + field values
         |
         v
Unique code generation --> MySQL serialization record
         |                           |
         v                           v
 Network printer                Print status
         |
         v
    Printed code --> Cognex scan --> Verification status
```

TrackForge uses a React/Vite frontend served by an Express backend. The backend maintains the device connections, exposes the local API, manages printer jobs, and persists recipes and serial records in MySQL.

## Technology

- React 19 and Vite
- Tailwind CSS
- Node.js and Express
- TypeScript/TSX backend
- MySQL
- Cognex DMCC over Telnet
- TCP-JSON, ZPL II, and raw TCP printer communication

## Requirements

- Node.js 20 or newer
- npm
- MySQL 8 or compatible server for recipes and serialization
- Optional: a Cognex DataMan reader reachable from the TrackForge host
- Optional: a compatible network printer reachable from the TrackForge host

The camera and printer are not required when both devices are configured in simulation mode.

## Local setup

1. Clone the repository and enter the project folder.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and update the settings for your environment.
4. Create the configured MySQL database. TrackForge creates its required tables when the server starts.
5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000` unless a different `PORT` is configured.

## Configuration

Common environment variables are shown below. Device settings can also be changed from the TrackForge interface.

| Variable | Purpose | Typical default |
| --- | --- | --- |
| `PORT` | Web server port | `3000` |
| `MYSQL_HOST` | MySQL server address | `127.0.0.1` |
| `MYSQL_PORT` | MySQL server port | `3306` |
| `MYSQL_USER` | MySQL username | `root` |
| `MYSQL_PASSWORD` | MySQL password | empty |
| `MYSQL_DATABASE` | Recipe and serialization database | `camera_simulator` |
| `COGNEX_HOST` | Cognex reader address | device-specific |
| `COGNEX_PORT` | Cognex Telnet port | `23` |
| `COGNEX_USER` | Cognex username | `admin` |
| `COGNEX_PASSWORD` | Cognex password | empty |
| `COGNEX_TIMEOUT_MS` | Camera command timeout | `4000` |
| `COGNEX_SIMULATED` | Enable simulated camera behavior | `false` |
| `COGNEX_AUTO_RECONNECT` | Reconnect the camera automatically | `true` |
| `COGNEX_FTP_IMAGE_DIR` | Directory containing uploaded camera images | `data/cognex-ftp-images` |
| `PRINTER_HOST` | Network printer address | device-specific |
| `PRINTER_PORT` | Printer TCP port | `9944` |
| `PRINTER_PROTOCOL` | Printer communication protocol | `TCP_JSON` |
| `PRINTER_TIMEOUT_MS` | Printer request timeout | `4000` |
| `PRINTER_SIMULATED` | Enable simulated printer behavior | `false` |
| `PRINTER_AUTO_RECONNECT` | Reconnect the printer automatically | `true` |
| `PRINTER_MESSAGE_NAME` | Default printer message/template | empty |
| `PRINTER_DYNAMIC_FIELD_NAME` | Default variable field | `dynamic_text` |
| `PRINTER_LABEL_WIDTH_MM` | Preview label width | `100` |
| `PRINTER_LABEL_HEIGHT_MM` | Preview label height | `50` |
| `PRINTER_DPI` | Printer resolution | `300` |

Do not commit real device passwords or database credentials. Keep them in a local `.env` file or a managed secret store.

## Recommended first run

1. Enable simulation for the camera and printer.
2. Connect both simulated devices and trigger a sample camera read.
3. Open printer management and inspect the available message fields.
4. Create a recipe containing the required fixed, editable, and serial fields.
5. Generate a small batch and review the complete codes before printing.
6. Print the batch in simulation mode and confirm that print states update correctly.
7. Scan or simulate the resulting codes and confirm their verification states.
8. Only then configure the addresses and credentials for physical equipment.

When commissioning real hardware, begin with a single test label. Confirm the selected message, field mapping, label dimensions, print quality, scan result, and stored status before starting a batch or continuous job.

## Available commands

```bash
npm run dev       # Run TrackForge in development mode
npm run lint      # Run TypeScript checks
npm run build     # Build the frontend and bundled server
npm start         # Run the production build
npm run preview   # Preview the Vite frontend build
```

For a production-style run:

```bash
npm run build
npm start
```

## Operational notes

- The TrackForge host must have network access to both physical devices.
- Cognex image display expects another FTP/image-logging process to place images in `COGNEX_FTP_IMAGE_DIR`; TrackForge does not act as an FTP server.
- Recipe and serialization features require a working MySQL connection.
- Use the communication logs to diagnose timeouts, rejected printer commands, or camera login problems.
- Stop and review an active job if failure counts increase or printed codes cannot be verified.
- Back up the MySQL database according to the traceability and retention requirements of your installation.

## Project status

TrackForge is under active development. Hardware behavior can vary by camera firmware, printer model, message configuration, and network environment. Test all workflows against the exact production equipment and configuration before deployment.

## License

No license has been specified yet. Add a `LICENSE` file before distributing or reusing this project outside your organization.
