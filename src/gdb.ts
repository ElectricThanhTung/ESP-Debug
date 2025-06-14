
import {
    StackFrame, Source,
    Variable, Breakpoint
} from '@vscode/debugadapter';
import * as path from "path";
import * as vscode from 'vscode';
import * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';
import { GDBStackFrame } from './gdb_stack_frame'
import { MIParser } from './mi_parser';
import { Semaphore } from './semaphore';

export class GDB extends EventEmitter {
    private gdbProcess?: ChildProcess.ChildProcess;
    private stdoutbuff = '';
    private stderrbuff = '';
    private status: 'startup' | 'stopped' | 'running' = 'startup';
    private breakPoints: any[] = [];
    private gdbSemaphore = new Semaphore(1);
    private responseCallback?: (data: any) => void;

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
        if(str[0] === '*') {
            const data = MIParser.parser(str);
            switch(data['gdb status']) {
                case 'stopped':
                    this.status = 'stopped';
                    this.stackFrame = [];
                    this.stackFrame.push(this.getStackFrame(data));
                    this.emit('stopped', 'generic');
                    break;
                default:
                    break;
            }
            return true;
        }
        else if(str[0] === '^') {
            const data = MIParser.parser(str);
            if(data['gdb status'] === 'running')
                this.status = 'running';
            if(this.responseCallback) {
                this.responseCallback(data);
                this.responseCallback = undefined;
            }
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

    private onResponseReceived(callback: (data: any) => void) {
        this.responseCallback = callback;
    }

    private removeResponseCallback() {
        this.responseCallback = undefined;
    }

    private writeCmd(cmd: string, timeout = 500): Promise<any> {
        return new Promise<any>((resolve) => {
            this.gdbSemaphore.acquire().then(() => {
                this.emit('gdbout', cmd);

                this.gdbProcess?.stdin?.write(cmd + '\n');

                const timeoutTask = setTimeout(() => {
                    this.removeResponseCallback();
                    this.gdbSemaphore.release();
                    resolve(undefined);
                }, timeout);

                this.onResponseReceived((data) => {
                    this.gdbSemaphore.release();
                    clearTimeout(timeoutTask);
                    resolve(data);
                });
            });
        });
    }

    public async continueRequest(): Promise<boolean> {
        const resp = await this.writeCmd('-exec-continue');
        if(!resp)
            return false;
        const status = resp['gdb status'];
        if(status === 'done' || status === 'running')
            return true;
        return false;
    }

    public async stepInRequest(): Promise<boolean> {
        const resp = await this.writeCmd('-exec-step');
        if(!resp)
            return false;
        const status = resp['gdb status'];
        if(status === 'done' || status === 'running')
            return true;
        return false;
    }

    public async stepOverRequest(): Promise<boolean> {
        const resp = await this.writeCmd('-exec-next');
        if(!resp)
            return false;
        const status = resp['gdb status'];
        if(status === 'done' || status === 'running')
            return true;
        return false;
    }

    public async stepOutRequest(): Promise<boolean> {
        const resp = await this.writeCmd('-exec-finish');
        if(!resp)
            return false;
        const status = resp['gdb status'];
        if(status === 'done' || status === 'running')
            return true;
        return false;
    }

    public async interruptRequest(): Promise<boolean> {
        const resp = await this.writeCmd('-exec-interrupt');
        if(!resp)
            return false;
        const status = resp['gdb status'];
        if(status === 'done' || status === 'running')
            return true;
        return false;
    }

    public async terminateRequest() {
        await this.writeCmd('-target-disconnect');
        this.writeCmd('-gdb-exit');
    }

    private getRemovedBreakpoints(lines: number[], source: string): any[] {
        const ret: any[] = [];
        this.breakPoints.forEach(bkp => {
            if(!lines.find((line) => ((line === bkp.line) && (bkp.file === source))))
                ret.push(bkp);
        });
        return ret;
    }

    private async deleteBreakPointRequest(bkp: any): Promise<boolean> {
        const resp = await this.writeCmd(`-break-delete ${bkp.number}`);
        if(!resp)
            return false;
        const status = resp['gdb status'];
        if(status === 'done' || status === 'running') {
            const index = this.breakPoints.findIndex((element) => element === bkp);
            this.breakPoints.splice(index, 1);
            return true;
        }
        return false;
    }

    private async addBreakPointRequest(lines: number, source: string): Promise<any> {
        return this.writeCmd(`-break-insert ${source}:${lines}`);
    }

    public async setBreakPointsRequest(lines: number[], source: string): Promise<Breakpoint[]> {
        const ret: Breakpoint[] = [];
        source = source.replace(/\\/g, '/');
        const bkpSource = new Source(path.basename(source), source);
        const removedBreakpoints = this.getRemovedBreakpoints(lines, source);
        removedBreakpoints.forEach(bkp => this.deleteBreakPointRequest(bkp));
        for(let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if(this.breakPoints.find(bkp => (line === bkp.line) && (bkp.file === source)))
                ret.push(new Breakpoint(true, line, 1, bkpSource));
            else {
                const resp = await this.addBreakPointRequest(line, source);
                if(resp && resp['gdb status'] === 'done') {
                    const bkp = {
                        number: parseInt(resp.bkpt.number),
                        addr: parseInt(resp.bkpt.addr, 16),
                        func: resp.bkpt.func,
                        line: parseInt(resp.bkpt.line),
                        file: source
                    };
                    this.breakPoints.push(bkp);
                    ret.push(new Breakpoint(true, bkp.line, 1, bkpSource));
                }
                else
                    ret.push(new Breakpoint(false, line, 1, bkpSource));
            }
        }
        return ret;
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
