
export class GDBStackFrame {
    public readonly addr: number;
    public readonly line: number;
    public readonly func: string;
    public readonly file: string;

    public constructor(addr: number, line: number, func: string, file: string) {
        this.addr = addr;
        this.line = line;
        this.func = func;
        this.file = file;
    }
}
