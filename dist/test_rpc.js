"use strict";
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
class TestCase {
    constructor(schema, handler, test, mw, main, dir = mktemp()) {
        this.schema = schema;
        this.handler = handler;
        this.test = test;
        this.mw = mw;
        this.dir = dir;
        this.main = main || `
import { AddressInfo } from 'net';
import { TestServer } from './server';
import { TestClient } from './client';
import Handler from './handler';
${this.mw ? "import mw from './mw';" : ''}
import test from './test';

async function main() {
  const h = new Handler();

  const server = new TestServer(h, true${this.mw ? ', [mw]' : ''});
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
        const { code: schemaCode } = await index_1.generate(schemaPath);
        await Promise.all(Object.entries(schemaCode).map(([n, c]) => fs_1.writeFile(path.join(this.dir, n), c)));
        await fs_1.writeFile(path.join(this.dir, 'main.ts'), this.main);
        if (this.mw) {
            await fs_1.writeFile(path.join(this.dir, 'mw.ts'), this.mw);
        }
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
describe('rpc', () => {
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
    it('supports the void return type', async () => {
        const schema = `
export interface Test {
  bar: {
    params: {
      a: string;
    };
    returns: null;
  };
}`;
        const handler = `
export default class Handler {
  public async bar(a: string): Promise<void> {
  }
}
`;
        const test = `
import { TestClient } from './client';

export default async function test(client: TestClient) {
 expect(await client.bar('heh')).to.be.undefined;
}
`;
        await new TestCase(schema, handler, test).run();
    });
    it('supports empty params', async () => {
        const schema = `
export interface Test {
  bar: {
    params: {
    };
    returns: string;
  };
}`;
        const handler = `
export default class Handler {
  public async bar(): Promise<string> {
    return 'heh';
  }
}
`;
        const test = `
import { TestClient } from './client';

export default async function test(client: TestClient) {
 expect(await client.bar()).to.be.eql('heh');
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
  public async raise(exc: string): Promise<void> {
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
  public async raise(exc: string): Promise<void> {
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
    it('supports the ServerOnlyContext interface', async () => {
        const schema = `
export interface ServerOnlyContext {
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
import { Context } from './server';

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
    it('supports the ClientContext interface', async () => {
        const schema = `
export interface ClientContext {
  debugId: string;
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
import { Context } from './server';

export default class Handler {
  public async hello({ debugId }: Context, name: string): Promise<string> {
    return 'Hello, ' + name + ' d ' + debugId;
  }
}
`;
        const test = `
import { TestClient, Context } from './client';

export default async function test(client: TestClient) {
  const result = await client.hello({ debugId: '666' } as Context, 'vova');
  expect(result).to.equal('Hello, vova d 666');
}
`;
        await new TestCase(schema, handler, test).run();
    });
    it('supports the combination of ClientContext and ServerOnlyContext', async () => {
        const schema = `
export interface ClientContext {
  debugId: string;
}

export interface ServerOnlyContext {
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
import { Context, ServerOnlyContext } from './server';

export default class Handler {
  public async extractContext(_: koa.Context): Promise<ServerOnlyContext> {
    return { ip: 'test' };
  }

  public async hello({ debugId, ip }: Context, name: string): Promise<string> {
    return 'Hello, ' + name + ' d ' + debugId + ' from ' + ip;
  }
}
`;
        const test = `
import { TestClient, Context } from './client';

export default async function test(client: TestClient) {
  const result = await client.hello({ debugId: '666' } as Context, 'vova');
  expect(result).to.equal('Hello, vova d 666 from test');
}
`;
        await new TestCase(schema, handler, test).run();
    });
    const dummySchema = `
export interface Test {
  bar: {
    params: {
      /**
       * @minLength 1
       */
      a: string;
    };
    returns: string;
  };
}`;
    const dummyMain = `
import test from './test';

async function main() {
  try {
    await test();
    process.exit(0);
  } catch(err) {
    console.error(err);
    process.exit(1);
  }
}

main();
    `;
    it('forwards network errors', async () => {
        // TODO: potential race condition if port reopens by other process immediately after close
        const test = `
import { TestClient } from './client';
import { AddressInfo } from 'net';
import * as http from 'http';

export default async function test() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const { address, port } = (server.address() as AddressInfo);
  const client = new TestClient('http://' + address + ':' + port);
  server.close();
  await expect(client.bar('heh')).to.eventually.be.rejectedWith(/^Error: connect ECONNREFUSED/);
}
`;
        await new TestCase(dummySchema, '', test, undefined, dummyMain).run();
    });
    it('handles empty 500 responses', async () => {
        const test = `
import { TestClient } from './client';
import { StatusCodeError } from 'request-promise-native/errors';
import { AddressInfo } from 'net';
import * as http from 'http';

export default async function test() {
  const server = http.createServer((req, res) => {
      res.statusCode = 500;
      res.statusMessage = 'sorry';
      res.end();
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const { address, port } = (server.address() as AddressInfo);
  const client = new TestClient('http://' + address + ':' + port);
  await expect(client.bar('heh')).to.eventually.be.rejectedWith(StatusCodeError, '500 - undefined');
}
`;
        await new TestCase(dummySchema, '', test, undefined, dummyMain).run();
    });
    it('handles non-json 500 responses', async () => {
        const test = `
import { TestClient } from './client';
import { StatusCodeError } from 'request-promise-native/errors';
import { AddressInfo } from 'net';
import * as http from 'http';

export default async function test() {
  const server = http.createServer((req, res) => {
      res.statusCode = 500;
      res.statusMessage = 'Internal Server Error';
      res.end('Internal Server Error');
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const { address, port } = (server.address() as AddressInfo);
  const client = new TestClient('http://' + address + ':' + port);
  await expect(client.bar('heh')).to.eventually.be.rejectedWith(StatusCodeError, '500 - "Internal Server Error"');
}
`;
        await new TestCase(dummySchema, '', test, undefined, dummyMain).run();
    });
    it('throws 400 errors on validation issues', async () => {
        const handler = `
export default class Handler {
  public async bar(name: string): Promise<string> {
    return 'Hello, ' + name;
  }
}
`;
        const test = `
import { StatusCodeError } from 'request-promise-native/errors';
import { TestClient } from './client';

export default async function test(client: TestClient) {
  await expect(client.bar('')).to.eventually.be.rejectedWith(StatusCodeError, '400 - "Bad Request"');
}
`;
        await new TestCase(dummySchema, handler, test).run();
        await new TestCase(dummySchema, '', test, undefined, dummyMain).run();
    });
});
//# sourceMappingURL=test_rpc.js.map