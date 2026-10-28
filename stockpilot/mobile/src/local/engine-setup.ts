// Runs before the shared engine loads: it reads its tables and the Excel reader from globals.
import * as XLSX from 'xlsx';

import config from './generated/engine-config.json';

const g = globalThis as unknown as { ENGINE_CONFIG: unknown; XLSX: unknown };
g.ENGINE_CONFIG = config;
g.XLSX = XLSX;
