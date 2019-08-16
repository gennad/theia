/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import * as theia from '@theia/plugin';
import { CommandRegistryExt, PLUGIN_RPC_CONTEXT as Ext, CommandRegistryMain } from '../common/plugin-api-rpc';
import { RPCProtocol } from '../common/rpc-protocol';
import { Disposable } from './types-impl';
import { KnownCommands } from './type-converters';
import { DisposableCollection } from '@theia/core';

// tslint:disable-next-line:no-any
export type Handler = <T>(...args: any[]) => T | PromiseLike<T | undefined>;

export interface ArgumentProcessor {
    // tslint:disable-next-line:no-any
    processArgument(arg: any): any;
}

export class CommandRegistryImpl implements CommandRegistryExt {

    private proxy: CommandRegistryMain;
    private readonly commands = new Set<string>();
    private readonly handlers = new Map<string, Handler>();
    private readonly argumentProcessors: ArgumentProcessor[];
    private readonly commandsConverter: CommandsConverter;

    constructor(rpc: RPCProtocol) {
        this.proxy = rpc.getProxy(Ext.COMMAND_REGISTRY_MAIN);
        this.argumentProcessors = [];
        this.commandsConverter = new CommandsConverter(this);
    }

    get converter(): CommandsConverter {
        return this.commandsConverter;
    }

    // tslint:disable-next-line:no-any
    registerCommand(command: theia.CommandDescription, handler?: Handler, thisArg?: any): Disposable {
        if (this.commands.has(command.id)) {
            throw new Error(`Command ${command.id} already exist`);
        }
        this.commands.add(command.id);
        this.proxy.$registerCommand(command);

        const toDispose: Disposable[] = [];
        if (handler) {
            toDispose.push(this.registerHandler(command.id, handler, thisArg));
        }
        toDispose.push(Disposable.create(() => {
            this.commands.delete(command.id);
            this.proxy.$unregisterCommand(command.id);
        }));
        return Disposable.from(...toDispose);
    }

    // tslint:disable-next-line:no-any
    registerHandler(commandId: string, handler: Handler, thisArg?: any): Disposable {
        if (this.handlers.has(commandId)) {
            throw new Error(`Command "${commandId}" already has handler`);
        }
        this.proxy.$registerHandler(commandId);
        // tslint:disable-next-line:no-any
        this.handlers.set(commandId, (...args: any[]) => handler.apply(thisArg, args));
        return Disposable.create(() => {
            this.handlers.delete(commandId);
            this.proxy.$unregisterHandler(commandId);
        });
    }

    dispose(): void {
        throw new Error('Method not implemented.');
    }

    // tslint:disable-next-line:no-any
    $executeCommand<T>(id: string, ...args: any[]): PromiseLike<T | undefined> {
        if (this.handlers.has(id)) {
            return this.executeLocalCommand(id, ...args);
        } else {
            return Promise.reject(new Error(`Command: ${id} does not exist.`));
        }
    }

    // tslint:disable:no-any
    executeCommand<T>(id: string, ...args: any[]): PromiseLike<T | undefined> {
        if (this.handlers.has(id)) {
            return this.executeLocalCommand(id, ...args);
        } else {
            return KnownCommands.map(id, args, (mappedId: string, mappedArgs: any[] | undefined) =>
                this.proxy.$executeCommand(mappedId, ...mappedArgs));
        }
    }
    // tslint:enable:no-any

    getKeyBinding(commandId: string): PromiseLike<theia.CommandKeyBinding[] | undefined> {
        return this.proxy.$getKeyBinding(commandId);
    }

    // tslint:disable-next-line:no-any
    private async executeLocalCommand<T>(id: string, ...args: any[]): Promise<T | undefined> {
        const handler = this.handlers.get(id);
        if (handler) {
            return handler<T>(...args.map(arg => this.argumentProcessors.reduce((r, p) => p.processArgument(r), arg)));
        } else {
            throw new Error(`Command ${id} doesn't exist`);
        }
    }

    async getCommands(filterUnderscoreCommands: boolean = false): Promise<string[]> {
        const result = await this.proxy.$getCommands();
        if (filterUnderscoreCommands) {
            return result.filter(command => command[0] !== '_');
        }
        return result;
    }

    registerArgumentProcessor(processor: ArgumentProcessor): void {
        this.argumentProcessors.push(processor);
    }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// copied and modified from https://github.com/microsoft/vscode/blob/1.37.1/src/vs/workbench/api/common/extHostCommands.ts#L217-L259
export class CommandsConverter {

    private readonly safeCommandId: string;
    private readonly commands: CommandRegistryImpl;
    private readonly commandsMap = new Map<number, theia.Command>();
    private handle = 0;
    private isSafeCommandRegistered: boolean;

    constructor(commands: CommandRegistryImpl) {
        this.safeCommandId = `theia_safe_cmd_${Date.now().toString()}`;
        this.commands = commands;
        this.isSafeCommandRegistered = false;
    }

    /**
     * Convert to a command that can be safely passed over JSON-RPC.
     */
    toSafeCommand(command: theia.Command, disposables: DisposableCollection): theia.Command {
        if (!this.isSafeCommandRegistered) {
            this.commands.registerCommand({ id: this.safeCommandId }, this.executeSafeCommand, this);
            this.isSafeCommandRegistered = true;
        }

        const result: theia.Command = {};
        Object.assign(result, command);

        if (command.command && command.arguments && command.arguments.length > 0) {
            const id = this.handle++;
            this.commandsMap.set(id, command);
            disposables.push(new Disposable(() => this.commandsMap.delete(id)));
            result.command = this.safeCommandId;
            result.arguments = [id];
        }

        return result;
    }

    // tslint:disable-next-line:no-any
    private executeSafeCommand<R>(...args: any[]): PromiseLike<R | undefined> {
        const command = this.commandsMap.get(args[0]);
        if (!command || !command.command) {
            return Promise.reject('command NOT FOUND');
        }
        return this.commands.executeCommand(command.command, ...(command.arguments || []));
    }

}
