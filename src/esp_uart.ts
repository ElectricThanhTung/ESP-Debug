
import { SerialPort } from 'serialport';

export class EspUart {
    private static async open(port: string, baudrate: number = 115200): Promise<SerialPort | undefined> {
        return new Promise<SerialPort | undefined>((resolve) => {
            const serialPort = new SerialPort({
                path: port,
                baudRate: baudrate,
                autoOpen: true,
            });
            serialPort.on('open', () => {
                resolve(serialPort);
            });
            serialPort.on('error', (err) => {
                EspUart.close(serialPort);
                resolve(undefined);
            });
        });
    }

    private static async targetEnable(serialPort: SerialPort, enable: boolean): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            serialPort.set({ dtr: false, rts: !enable }, (err) => resolve(err ? false : true));
        });
    }

    private static async write(serialPort: SerialPort, data: Buffer): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            serialPort.write((data), (err) => resolve(err ? false : true));
        });
    }

    private static async close(serialPort: SerialPort) {
        serialPort.removeAllListeners();
        serialPort.close();
    }

    private static async delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    public static async targetReset(port: string): Promise<boolean> {
        const serialPort = await EspUart.open(port);
        if(!serialPort)
            return false;
        if(!await EspUart.targetEnable(serialPort, false)) {
            await EspUart.close(serialPort);
            return false;
        }
        await EspUart.delay(20);
        if(!await EspUart.targetEnable(serialPort, true)) {
            await EspUart.close(serialPort);
            return false;
        }
        await EspUart.close(serialPort);
        await EspUart.delay(500);
        return true;
    }

    public static async interruptRequest(port: string, baudrate: number): Promise<boolean> {
        const serialPort = await EspUart.open(port, baudrate);
        if(!serialPort)
            return false;
        if(!await EspUart.write(serialPort, Buffer.from([0x03]))) {
            await EspUart.close(serialPort);
            return false;
        }
        await EspUart.close(serialPort);
        return true;
    }
}
