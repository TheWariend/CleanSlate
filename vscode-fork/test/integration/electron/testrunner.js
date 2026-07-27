"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CleanSlate. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.configure = configure;
exports.run = run;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const Mocha = require("mocha");
let mochaOptions = {
    ui: 'tdd',
    color: true
};
function configure(options) {
    mochaOptions = { ...mochaOptions, ...options };
}
function collectTestFiles(root) {
    const files = [];
    const visit = (entry) => {
        const stat = fs.statSync(entry);
        if (stat.isDirectory()) {
            for (const child of fs.readdirSync(entry)) {
                visit(path.join(entry, child));
            }
            return;
        }
        if (entry.endsWith('.test.js') || entry.endsWith('.test.mjs')) {
            files.push(entry);
        }
    };
    if (fs.existsSync(root)) {
        visit(root);
    }
    return files.sort();
}
function run(testRoot, callback) {
    try {
        const mocha = new Mocha(mochaOptions);
        for (const file of collectTestFiles(testRoot)) {
            mocha.addFile(file);
        }
        mocha.run(failures => callback(failures > 0 ? new Error(`${failures} test failure${failures === 1 ? '' : 's'}`) : null, failures));
    }
    catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
    }
}
//# sourceMappingURL=testrunner.js.map