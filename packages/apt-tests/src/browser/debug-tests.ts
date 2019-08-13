/********************************************************************************
 * Copyright (C) 2019 Red Hat, Inc. and others.
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

import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { BreakpointManager } from '@theia/debug/lib/browser/breakpoint/breakpoint-manager';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from 'inversify';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { DebugThread } from '@theia/debug/lib/browser/model/debug-thread';

export const START_DEBUG_TESTS: Command = {
    id: 'api-tests.debug',
    label: 'Start debug API tests',
};

@injectable()
export class DebugTest implements CommandContribution {

    @inject(DebugSessionManager)
    protected readonly debugSessionManager: DebugSessionManager;

    @inject(BreakpointManager)
    protected readonly breakpointManager: BreakpointManager;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(START_DEBUG_TESTS, {
            execute: () => this.doTests()
        });
    }

    protected async doTests(): Promise<void> {
        // this.workspaceService.open(new URI('file:///home/tolusha/projects/test-project'));

        this.breakpointManager.cleanAllMarkers();
        this.breakpointManager.addBreakpoint({
            id: '1',
            enabled: true,
            uri: 'file:///home/tolusha/projects/test-project/test.cpp',
            raw: {
                column: 1,
                line: 5
            }
        });

        const debugSession = await this.debugSessionManager.start({
            configuration: {
                type: 'gdb',
                name: 'Debug c++ application',
                request: 'launch',
                program: '/home/tolusha/projects/test-project/a.out'
            }
        });

        if (!debugSession) {
            throw new Error('Debug Session is not initialized');
        }

        let deferredThread = new Deferred<DebugThread>();
        debugSession.onDidChange(() => deferredThread.resolve(debugSession.threads.next().value));

        let thread = await deferredThread.promise;
        let response = await debugSession.sendRequest('next', { threadId: thread.raw.id });
        console.log('[Debug API Tests]: ', JSON.stringify(response));

        deferredThread = new Deferred<DebugThread>();

        thread = await deferredThread.promise;
        response = await debugSession.sendRequest('continue', { threadId: thread.raw.id });
        console.log('[Debug API Tests]: ', JSON.stringify(response));
    }
}
