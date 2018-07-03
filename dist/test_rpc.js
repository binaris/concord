"use strict";
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i;
    function verb(n) { if (g[n]) i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r);  }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
Object.defineProperty(exports, "__esModule", { value: true });
require("chai-as-promised");
require("mocha");
const util_1 = require("util");
const path = require("path");
const crypto_1 = require("crypto");
const rmrf = require("rimraf");
const fs_1 = require("mz/fs");
const child_process_1 = require("mz/child_process");
const index_1 = require("./index");
function mktemp() {
    return path.join(__dirname, '..', 'tmpTestCases', `test-${crypto_1.randomBytes(20).toString('hex')}`);
}
function writeTempFile(contents) {
    return __asyncGenerator(this, arguments, function* writeTempFile_1() {
        const filename = mktemp();
        yield __await(fs_1.writeFile(filename, contents));
        try {
            yield filename;
        }
        finally {
            yield __await(fs_1.unlink(filename));
        }
    });
}
class TestCase {
    constructor(schema, handler, test, dir = mktemp()) {
        this.schema = schema;
        this.handler = handler;
        this.test = test;
        this.dir = dir;
        this.main = `
import { AddressInfo } from 'net';
import { TestServer } from './server';
import { TestClient } from './client';
import Handler from './handler';
import test from './test';

async function main() {
  const h = new Handler();

  const server = new TestServer(h);
  const listener = await server.listen(0, '127.0.0.1');
  const { address, port } = (listener.address() as AddressInfo);
  const client = new TestClient('http://' + address + ':' + port);
  await test(client);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
    }
    async setup() {
        await fs_1.mkdir(this.dir);
        const schemaPath = path.join(this.dir, 'schema.ts');
        await fs_1.writeFile(schemaPath, this.schema);
        const schemaCode = await index_1.generate(schemaPath);
        await Promise.all(Object.entries(schemaCode).map(([n, c]) => fs_1.writeFile(path.join(this.dir, n), c)));
        await fs_1.writeFile(path.join(this.dir, 'main.ts'), this.main);
        await fs_1.writeFile(path.join(this.dir, 'handler.ts'), this.handler);
        await fs_1.writeFile(path.join(this.dir, 'test.ts'), `
import { expect, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);
${this.test}`);
    }
    async cleanup() {
        await util_1.promisify(rmrf)(this.dir);
    }
    async exec() {
        const testPath = path.join(this.dir, 'main.ts');
        const [stdout, stderr] = await child_process_1.exec(`ts-node ${testPath}`);
        return { stdout: stdout.toString(), stderr: stderr.toString() };
    }
    async run() {
        try {
            await this.setup();
            return await this.exec();
            // } catch (err) {
            //   console.error(err);
            //   throw err;
        }
        finally {
            // await this.cleanup();
        }
    }
}
describe('generate', () => {
    it('creates valid TS client / server code', async () => {
        const schema = `
export interface Test {
  bar: {
    params: {
      a: number;
    };
    returns: string;
  };
}`;
        const handler = `
export default class Handler {
  public async bar(a: number): Promise<string> {
    return a.toString();
  }
}
`;
        const test = `
import { TestClient } from './client';

export default async function test(client: TestClient) {
 expect(await client.bar(3)).to.equal('3');
}
`;
        await new TestCase(schema, handler, test).run();
    });
    it('works with $reffed schemas', async () => {
        const schema = `
export interface User {
  name: string;
}

export interface Test {
  authenticate: {
    params: {
      token: string;
    };
    returns: User;
  };
}`;
        const handler = `
import { User } from './interfaces';

export default class Handler {
  public async authenticate(token: string): Promise<User> {
    return { name: 'Vova' };
  }
}
`;
        const test = `
import { TestClient } from './client';

export default async function test(client: TestClient) {
 expect(await client.authenticate('token')).to.eql({ name: 'Vova' });
}
`;
        await new TestCase(schema, handler, test).run();
    });
    it('coerces Date in param and return', async () => {
        const schema = `
export interface Test {
  dateIncrement: {
    params: {
      d: Date;
    };
    returns: Date;
  };
}`;
        const handler = `
export default class Handler {
  public async dateIncrement(d: Date): Promise<Date> {
    return new Date(d.getTime() + 1);
  }
}
`;
        const test = `
import { TestClient } from './client';

export default async function test(client: TestClient) {
 const d = new Date();
 expect(await client.dateIncrement(d)).to.eql(new Date(d.getTime() + 1));
}
`;
        await new TestCase(schema, handler, test).run();
    });
    it('constructs Error classes from and only from declared errors', async () => {
        const schema = `
export class RuntimeError extends Error {}

export interface Test {
  raise: {
    params: {
      exc: string;
    };
    returns: null;
    throws: RuntimeError;
  };
}`;
        const handler = `
import { RuntimeError } from './interfaces';

export default class Handler {
  public async raise(exc: string): Promise<undefined> {
    if (exc === 'RuntimeError') {
      throw new RuntimeError('heh');
    }
    throw new Error('ho');
  }
}
`;
        const test = `
import { RuntimeError, InternalServerError } from './interfaces';
import { TestClient } from './client';

export default async function test(client: TestClient) {
  await expect(client.raise('RuntimeError')).to.eventually.be.rejectedWith(RuntimeError, 'heh');
  await expect(client.raise('UnknownError')).to.eventually.be.rejectedWith(InternalServerError);
}
`;
        await new TestCase(schema, handler, test).run();
    });
    it('constructs Error classes from and only from declared errors when multiple errors possible', async () => {
        const schema = `
export class RuntimeError extends Error {}
export class WalktimeError extends Error {}

export interface Test {
  raise: {
    params: {
      exc: string;
    };
    returns: null;
    throws: RuntimeError | WalktimeError;
  };
}`;
        const handler = `
import { RuntimeError, WalktimeError } from './interfaces';

export default class Handler {
  public async raise(exc: string): Promise<undefined> {
    if (exc === 'RuntimeError') {
      throw new RuntimeError('heh');
    }
    if (exc === 'WalktimeError') {
      throw new WalktimeError('hoh');
    }
    throw new Error('ho');
  }
}
`;
        const test = `
import { RuntimeError, WalktimeError, InternalServerError } from './interfaces';
import { TestClient } from './client';

export default async function test(client: TestClient) {
  await expect(client.raise('RuntimeError')).to.eventually.be.rejectedWith(RuntimeError, 'heh');
  await expect(client.raise('WalktimeError')).to.eventually.be.rejectedWith(WalktimeError, 'hoh');
  await expect(client.raise('UnknownError')).to.eventually.be.rejectedWith(InternalServerError);
}
`;
        await new TestCase(schema, handler, test).run();
    });
    it('supports the Context interface', async () => {
        const schema = `
export interface Context {
  ip: string;
}

export interface Test {
  hello: {
    params: {
      name: string;
    };
    returns: string;
  };
}`;
        const handler = `
import * as koa from 'koa';
import { Context } from './interfaces';

export default class Handler {
  public async extractContext(_: koa.Context): Promise<Context> {
    return { ip: 'test' };
  }

  public async hello({ ip }: Context, name: string): Promise<string> {
    return 'Hello, ' + name + ' from ' + ip;
  }
}
`;
        const test = `
import { TestClient } from './client';

export default async function test(client: TestClient) {
  const result = await client.hello('vova');
  expect(result).to.equal('Hello, vova from test');
}
`;
        await new TestCase(schema, handler, test).run();
    });
});
//# sourceMappingURL=test_rpc.js.map