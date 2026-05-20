import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const SCRIPTS_PATH = join(__dirname, 'scripts');
const MT5_PACKAGE_PATH = SCRIPTS_PATH;

interface MTAccountInfo {
  login: number;
  server: string;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  profit: number;
  currency: string;
}

interface MTTrade {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  price_open: number;
  price_close: number;
  profit: number;
  commission: number;
  swap: number;
  magic: number;
  comment: string;
  time_open: number;
  time_close: number;
}

interface MTPosition {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  price_open: number;
  price_current: number;
  profit: number;
  sl: number;
  tp: number;
  magic: number;
  comment: string;
  time: number;
}

function runPythonScript(script: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = spawn('python', [script, ...args], {
      cwd: __dirname,
      shell: false
    });

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0 && errorOutput) {
        reject(new Error(errorOutput.trim()));
      } else {
        resolve(output.trim());
      }
    });

    python.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      python.kill();
      reject(new Error('Python script timeout'));
    }, 30000);
  });
}

export const mt5Service = {
  async getAccountInfo(): Promise<MTAccountInfo | null> {
    try {
      const scriptPath = join(MT5_PACKAGE_PATH, 'get_account.py');
      
      if (!existsSync(scriptPath)) {
        throw new Error('MT5 Python script not found. Please install metatrader5 package.');
      }

      const output = await runPythonScript(scriptPath);
      const data = JSON.parse(output);
      
      return {
        login: data.login,
        server: data.server,
        balance: data.balance,
        equity: data.equity,
        margin: data.margin,
        free_margin: data.free_margin,
        profit: data.profit,
        currency: data.currency
      };
    } catch (error: any) {
      console.error('MT5 Account Info Error:', error.message);
      return null;
    }
  },

  async getPositions(): Promise<MTPosition[]> {
    try {
      const scriptPath = join(MT5_PACKAGE_PATH, 'get_positions.py');
      
      if (!existsSync(scriptPath)) {
        return [];
      }

      const output = await runPythonScript(scriptPath);
      const data = JSON.parse(output);
      
      return data.positions || [];
    } catch (error: any) {
      console.error('MT5 Positions Error:', error.message);
      return [];
    }
  },

  async getHistory(fromDate: Date, toDate: Date): Promise<MTTrade[]> {
    try {
      const scriptPath = join(MT5_PACKAGE_PATH, 'get_history.py');
      const fromStr = fromDate.toISOString().split('.')[0];
      const toStr = toDate.toISOString().split('.')[0];
      
      if (!existsSync(scriptPath)) {
        return [];
      }

      const output = await runPythonScript(scriptPath, [fromStr, toStr]);
      const data = JSON.parse(output);
      
      return data.deals || [];
    } catch (error: any) {
      console.error('MT5 History Error:', error.message);
      return [];
    }
  },

  async checkConnection(): Promise<boolean> {
    try {
      const info = await this.getAccountInfo();
      return info !== null;
    } catch {
      return false;
    }
  }
};

export default mt5Service;
