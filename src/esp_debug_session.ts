
import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
    ProgressStartEvent, ProgressUpdateEvent, ProgressEndEvent, InvalidatedEvent,
    Thread, StackFrame, Scope, Source, Handles, Breakpoint, MemoryEvent,
    Variable
} from '@vscode/debugadapter';
import * as fs from 'fs';
import * as vscode from 'vscode';
import path = require('path');
import { DebugProtocol } from '@vscode/debugprotocol';
import { GDB } from './gdb';
import { EspUart } from './esp_uart';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    cwd?: string;
    program: string;
    port: string;
    baudrate?: number;
}

export class EspDebugSession extends LoggingDebugSession {
    private gdb: GDB = new GDB();
    private gdbOutput = vscode.window.createOutputChannel('GDB Logs');
    private statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    private currentThreadId = 0;

    public constructor() {
        super('esp-debug.txt');
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments) {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        response.body.supportsStepInTargetsRequest = true;
        response.body.supportsSteppingGranularity = true;
        response.body.supportsDataBreakpoints = true;
        response.body.supportsCompletionsRequest = true;
        response.body.supportsCancelRequest = true;
        response.body.supportsBreakpointLocationsRequest = true;
        response.body.supportsExceptionFilterOptions = true;
        response.body.supportsExceptionInfoRequest = true;
        response.body.supportsSetVariable = true;
        response.body.supportsSetExpression = true;
        response.body.supportsDisassembleRequest = true;
        response.body.supportsInstructionBreakpoints = true;
        response.body.supportsReadMemoryRequest = true;
        response.body.supportsWriteMemoryRequest = true;
        response.body.supportSuspendDebuggee = true;
        response.body.supportTerminateDebuggee = true;
        response.body.supportsFunctionBreakpoints = true;
        response.body.supportsDelayedStackTraceLoading = false;
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsLogPoints = true;
        response.body.supportsRestartRequest = true;
        response.body.supportsTerminateRequest = true;
        response.body.supportsGotoTargetsRequest = true;

        // response.body.exceptionBreakpointFilters = [{filter: 'all', label: 'Caught Exceptions', default: false}];

        this.gdbOutput.show();

        this.gdb.on("stopped", (reason, threadId, allThreadsStopped) => {
            this.currentThreadId = threadId;
            const stoppedEvent = new StoppedEvent(reason, threadId);
            (stoppedEvent as any).body.allThreadsStopped = allThreadsStopped;
            this.sendEvent(stoppedEvent);
        });
        this.gdb.on("stdout", (data) => this.sendEvent(new OutputEvent(data, 'console')));
        this.gdb.on("gdbout", (data) => {
            this.gdbOutput.appendLine(data);
            if(/\~\"Reading symbols from .+\"/.test(data))
                this.statusBarItem.text = "$(sync~spin) Reading symbols...";
        });

        this.gdb.on("gdberr", (data) => {
            this.gdbOutput.appendLine(data);
            this.sendEvent(new TerminatedEvent());
        });

        this.sendResponse(response);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments, request?: DebugProtocol.Request) {
        const baudrate = args.baudrate ? args.baudrate : 115200;
        this.statusBarItem.show();

        this.statusBarItem.text = '$(sync~spin) Resetting target...';
        if(!await EspUart.targetReset(args.port)) {
            this.statusBarItem.hide();
            return this.sendErrorResponse(response, 1, 'Unable to reset target device, please check connection again');
        }

        this.statusBarItem.text = '$(sync~spin) Entering debug mode...';
        if(!await EspUart.interruptRequest(args.port, baudrate)) {
            this.statusBarItem.hide();
            return this.sendErrorResponse(response, 1, `Sending interrupt request to ${args.port} failed`);
        }

        const gdbCmd = path.join(__dirname, '..', 'gdb', 'win', 'xtensa-esp-elf-gdb', 'bin', 'xtensa-esp32-elf-gdb');
        const gdbArgs = [
            '-ex', 'set mi-async on',
            args.program,
            '--quiet',
            '--interpreter=mi2',
            '-ex', `set serial baud ${baudrate}`,
            '-ex', `target remote \\\\.\\${args.port}`
        ];

        this.statusBarItem.text = '$(sync~spin) Starting gdb...';
        if(!await this.gdb.launch(gdbCmd, gdbArgs)) {
            this.sendErrorResponse(response, 1, "GDB launch fail");
            this.gdb.terminateRequest();
            this.statusBarItem.hide();
            return;
        }
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());

        this.statusBarItem.hide();
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request) {
        this.sendResponse(response);
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments, request?: DebugProtocol.Request) {
        this.gdb.terminateRequest();
        this.sendResponse(response);
        this.sendEvent(new TerminatedEvent());
        this.statusBarItem.hide();
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request) {
        this.sendResponse(response);
    }

    protected async configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments, request?: DebugProtocol.Request | undefined) {
        this.sendResponse(response);
    }

    protected async setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments, request?: DebugProtocol.Request) {
        this.sendResponse(response);
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request) {
        if(args.lines && args.source.path) {
            try {
                const bkps = await this.gdb.setBreakPointsRequest(args.lines, args.source.path);
                response.body = {
                    breakpoints: bkps as Breakpoint[]
                };
                this.sendResponse(response);
            }
            catch(exception: any) {
                this.sendErrorResponse(response, 1, exception);
            }
            return;
        }
        this.sendResponse(response);
    }

    protected async setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments, request?: DebugProtocol.Request) {
        this.sendResponse(response);
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request | undefined) {
        this.gdb.interruptRequest();
        this.sendResponse(response);
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
        this.gdb.continueRequest();
        this.sendResponse(response);
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        this.gdb.stepOverRequest();
        this.sendResponse(response);
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.Request | undefined) {
        this.gdb.stepInRequest();
        this.sendResponse(response);
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request | undefined) {
        this.gdb.stepOutRequest();
        this.sendResponse(response);
    }

    protected async restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments, request?: DebugProtocol.Request | undefined) {
        this.sendResponse(response);
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request) {
        const scopes: DebugProtocol.Scope[] = [
            new Scope("Locals", 0x100000000 + args.frameId, true),
            new Scope("Registers", 0x200000000 + args.frameId, true),
        ];
        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {
        const variableType: bigint = BigInt(args.variablesReference) >> 32n;
        let ret;
        if(variableType === 1n) {           /* Locals */
            const frameId = args.variablesReference & 0xFFFFFFFF;
            ret = await this.gdb.localVariablesRequest(this.currentThreadId, frameId);
        }
        else if(variableType === 2n) {      /* Registers */
            const frameId = args.variablesReference & 0xFFFFFFFF;
            ret =  await this.gdb.registerRequest(this.currentThreadId, frameId);
        }
        else
            ret = await this.gdb?.variablesRequest(args.variablesReference);
        if(ret)
            response.body = {variables: ret};
        this.sendResponse(response);
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        if(!args.expression)
            return this.sendResponse(response);
        const ret = await this.gdb?.evaluateRequest(args.expression);
        if(!ret)
            return this.sendResponse(response);
        response.body = {
            result: ret.value,
            variablesReference: ret.variablesReference
        };
        this.sendResponse(response);
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
        const startFrame = (args.startFrame !== undefined) ? args.startFrame : 0;
        const levels = (args.levels !== undefined) ? args.levels : Infinity;
        const frames = await this.gdb.stackFrameRequest(args.threadId, startFrame, levels);
        if(!frames)
            return this.sendErrorResponse(response, 1, 'Cound not read stack frame');
        response.body = {
            stackFrames: frames,
            totalFrames: frames.length,
        };
        this.sendResponse(response);
    }

    protected async exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments) {
        this.sendResponse(response);
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse) {
        const threads = await this.gdb.threadRequest();
        if(!threads) {
            response.body = {
                threads: [
                    new Thread(1, 'thread 1'),
                ]
            };
            return this.sendResponse(response);
        }
        response.body = { threads: threads };
        this.sendResponse(response);
    }
}
