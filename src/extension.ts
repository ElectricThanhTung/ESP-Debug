import * as vscode from 'vscode';
import { ProviderResult } from 'vscode';
import { EspDebugSession } from './esp_debug_session';

export function activate(context: vscode.ExtensionContext) {
	let factory = new InlineDebugAdapterFactory();
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('esp-debug', factory));
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(new EspDebugSession());
    }
}

export function deactivate() {

}
