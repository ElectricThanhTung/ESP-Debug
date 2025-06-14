
import {
    StackFrame, Source,
    Variable, Breakpoint
} from '@vscode/debugadapter';
import * as vscode from 'vscode';
import * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';
import { GDBStackFrame } from './gdb_stack_frame'
import { MIParser } from './mi_parser';

export class GDB extends EventEmitter {
    private gdbProcess?: ChildProcess.ChildProcess;
    private stdoutbuff = "";
    private stderrbuff = "";

    private stackFrame: GDBStackFrame[] = [];

    public constructor() {
        super();
    }

    public launch(cmd: string, args: string[]): boolean {
        let cwd = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';

        this.gdbProcess = ChildProcess.spawn(cmd, args, { cwd: cwd, stdio: 'pipe' });
        this.gdbProcess.stdout?.on("data", (data: any) => this.stdout(data));
        this.gdbProcess.stderr?.on("data", (data: any) => this.stderr(data));
        this.gdbProcess.on("error", (err: any) => this.onError(err));
        this.gdbProcess.on("exit", (number: number, signal: string) => this.onExit(number, signal));

        return true;
    }

    private static getLine(data: string): string | undefined {
        const end = data.indexOf('\n');
        if(end >= 0)
            return data.substring(0, end);
        return undefined;
    }

    private stdout(data: any) {
        this.stdoutbuff += (typeof data === 'string') ? data : data.toString('utf8');
        let line: string | undefined;
        while(line = GDB.getLine(this.stdoutbuff)) {
            this.onStdout(line);
            this.stdoutbuff = this.stdoutbuff.substring(line.length + 1);
        }
    }

    private stderr(data: any) {
        this.stderrbuff += (typeof data === 'string') ? data : data.toString('utf8');
        let line: string | undefined;
        while(line = GDB.getLine(this.stderrbuff)) {
            this.onStderr(line);
            this.stderrbuff = this.stderrbuff.substring(line.length + 1);
        }
    }

    private getStackFrame(data: Record<string, any>): GDBStackFrame {
        const addr = parseInt(data.frame.addr, 16);
        const func = data.frame.func;
        const file = data.frame.file;
        const line = parseInt(data.frame.line);
        return new GDBStackFrame(addr, line, func, file);
    }

    private checkStatus(str: string): boolean {
        if(/[\^*]/.test(str[0])) {
            const [status, data] = MIParser.parser(str);
            switch(status) {
                case 'stopped':
                    this.stackFrame = [];
                    this.stackFrame.push(this.getStackFrame(data));
                    this.emit('stopped', 'generic');
                    break;
                case 'done':
                    break;
                case 'running':
                    break;
                default:
                    break;
            }
            return true;
        }
        else if(str[0] === '@')
            this.emit('stdout', MIParser.parseValues(str.substring(1)));
        return false;
    }

    private onStdout(str: string) {
        this.emit('gdbout', str);
        this.checkStatus(str);
    }

    private onStderr(str: string) {
        this.emit('gdberr', str);
    }

    private onError(err: any) {
        this.emit('gdberr', err);
    }

    private onExit(code: number, signal: string) {

    }

    private writeCmd(cmd: string): boolean {
        this.emit('gdbout', cmd);
        this.gdbProcess?.stdin?.write(cmd + '\n');
        return true;
    }

    public continueRequest(): boolean {
        this.writeCmd('-exec-continue');
        return true;
    }

    public stepInRequest(): boolean {
        this.writeCmd('-exec-step');
        return true;
    }

    public stepOverRequest(): boolean {
        this.writeCmd('-exec-next');
        return true;
    }

    public stepOutRequest(): boolean {
        this.writeCmd('-exec-finish');
        return true;
    }

    public async interruptRequest(): Promise<boolean> {
        this.writeCmd('-exec-interrupt');
        return true;
    }

    public async terminateRequest() {
        await this.writeCmd('-target-disconnect');
        this.writeCmd('-gdb-exit');
    }

    private static convertToStackFrame(stackFrames: GDBStackFrame[]): StackFrame[] {
        const ret: StackFrame[] = [];
        for(let i = 0; i < stackFrames.length; i++) {
            const addr = stackFrames[i].addr;
            const func = stackFrames[i].func;
            const file = stackFrames[i].file;
            const line = stackFrames[i].line;
            const src = new Source(file.substring(file.lastIndexOf('/')), file);
            const sf = new StackFrame(i, func, src, line);
            sf.instructionPointerReference = addr.toString();
            ret.push(sf);
        }
        return ret;
    }

    public async stackFrameRequest(): Promise<StackFrame[]> {
        return new Promise<StackFrame[]>((resolve) => {
            resolve(GDB.convertToStackFrame(this.stackFrame));
        });
    }
}
