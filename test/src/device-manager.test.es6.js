import * as sinon from 'sinon';
import { assert } from 'chai';
import os from 'os';
import fs from 'fs';
import stream from 'stream';
import cproc from 'child_process';
import RED from 'node-red';
import Promise from 'es6-promises';
import { DeviceIdResolver, DeviceState, DeviceManager, DeviceManagerStore } from '../../dist/device-manager';

const PROC_CPUINFO = [
  'processor	: 0\n',
  'model name	: ARMv6-compatible processor rev 7 (v6l)\n',
  'BogoMIPS	: 2.00\n',
  'Features	: half thumb fastmult vfp edsp java tls \n',
  'CPU implementer	: 0x41\n',
  'CPU architecture: 7\n',
  'CPU variant	: 0x0\n',
  'CPU part	: 0xb76\n',
  'CPU revision	: 7\n',
  'Hardware	: BCM2708\n',
  'Revision	: 0010\n',
  'Serial		: 00000000ffff9999\n',
  null
];

let server = sinon.spy();
let settings = sinon.spy();
RED.init(server, settings);

describe('DeviceIdResolver', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = sinon.sandbox.create();
  });
  afterEach(() => {
    sandbox.restore();
  });

  it('should resolve the unique device identifier', done => {
    let resolver = new DeviceIdResolver();
    resolver.resolve().then(id => {
      console.log(`id = [${id}]`);
      assert.isDefined(id);
      assert.isNotNull(id);
      done();
    }).catch(err => {
      done(err);
    });
  });

  it('should return the serial number', done => {
    let resolver = new DeviceIdResolver();
    sandbox.stub(fs, 'stat').yields();
    sandbox.stub(fs, 'readFile').yields(null, 'my-serial-number\n');
    resolver.resolve().then(id => {
      assert.equal('EDN:my-serial-number', id);
      done();
    }).catch(err => {
      done(err);
    });
  });

  it('should return the cpuinfo serial', done => {
    let resolver = new DeviceIdResolver();
    sandbox.stub(fs, 'stat').onFirstCall().yields(new Error()).onSecondCall().yields();
    let i = 0;
    let readStream = new stream.Readable();
    readStream._read = () => {
      readStream.push(PROC_CPUINFO[i++]);
    };
    sandbox.stub(fs, 'createReadStream').onFirstCall().returns(readStream);
    resolver.resolve().then(id => {
      assert.equal('RPi:00000000ffff9999', id);
      done();
    }).catch(err => {
      done(err);
    });
  });

  it('should return the MAC address', done => {
    let resolver = new DeviceIdResolver();
    sandbox.stub(fs, 'stat').onFirstCall().yields(new Error())
      .onSecondCall().yields(new Error())
      .onThirdCall().yields();
    sandbox.stub(os, 'networkInterfaces').returns({
      'en0' : [
        { mac: '00:00:00:00:00:00' },
        { mac: 'AA:bb:cc:dd:ee:FF' },
      ]
    });
    resolver.resolve().then(id => {
      assert.equal('MAC:en0:aa-bb-cc-dd-ee-ff', id);
      done();
    }).catch(err => {
      done(err);
    });
  });
});

describe('DeviceState', () => {
  let sandbox;
  let state;
  beforeEach(() => {
    state = new DeviceState(() => {}, () => {});
    sandbox = sinon.sandbox.create();
  });
  afterEach(() => {
    sandbox.restore();
  });

  describe('#testIfUIisEnabled()', () => {
    it('should return whether or not CANDY IoT board is installed', done => {
      state.testIfCANDYIoTInstalled().then(version => {
        console.log(`installed version? => [${version}]`);
        done();
      }).catch(err => {
        done(err);
      });
    });

    it('should return the installed CANDY IoT Board version', done => {
      let stubCproc = sandbox.stub(cproc);
      let which = sandbox.stub({
        on: () => {}
      });
      which.on.onFirstCall().yields(0);
      stubCproc.spawn.onFirstCall().returns(which);

      let stdout = sandbox.stub({
        on: () => {}
      });
      stdout.on.onFirstCall().yields(JSON.stringify({
        version: '1234'
      }));
      let ciot = sandbox.stub({
        stdout: stdout,
        on: () => {}
      });
      stubCproc.spawn.onSecondCall().returns(ciot);
      ciot.on.yields();

      state.testIfCANDYIoTInstalled().then(version => {
        assert.equal('1234', version);
        done();
      }).catch(err => {
        done(err);
      });
    });
  });

  describe('#testIfUIisEnabled()', () => {
    it('should tell the UI is enabled', done => {
      state.testIfUIisEnabled(__dirname + '/test-flow-enabled.json').then(enabled => {
        assert.isTrue(enabled);
        done();
      }).catch(err => {
        done(err);
      });
    });
    it('should tell the UI is DISABLED', done => {
      state.testIfUIisEnabled(__dirname + '/test-flow-disabled.json').then(enabled => {
        assert.isFalse(enabled);
        done();
      }).catch(err => {
        done(err);
      });
    });
  });
});

describe('DeviceManager', () => {
  let sandbox, manager;
  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    let listenerConfig = sandbox.stub({
      registerInputNode: () => {}
    });
    let accountConfig = {
      accountFqn: 'TEST@localhost'
    };
    manager = new DeviceManager(false, listenerConfig, accountConfig, new DeviceState());
  });
  afterEach(() => {
    sandbox.restore();
  });

  describe('#_enqueue()', () => {
    it('should enqueue a command if valid', () => {
      sandbox.stub(manager, 'publish').returns(new Promise(resolve => resolve()));
      manager._enqueue({});
      manager._enqueue(null);
      manager._enqueue(undefined);
      assert.equal(1, manager.cmdQueue.length);
    });
  });

  describe('#_resume()', () => {
    it('should resume queued commands', done => {
      sandbox.stub(manager, 'publish').returns(new Promise(resolve => resolve()));
      manager._enqueue({});
      manager._enqueue(null);
      manager._enqueue(undefined);
      manager._resume().then(empty => {
        assert.isNotTrue(empty);
        done();
      }).catch(err => {
        done(err);
      });
    });

    it('should terminate silently when there are not queued commands', done => {
      sandbox.stub(manager, 'publish').returns(new Promise(resolve => resolve()));
      manager._enqueue(null);
      manager._enqueue(undefined);
      manager._resume().then(empty => {
        assert.isTrue(empty);
        done();
      }).catch(err => {
        done(err);
      });
    });
  });
});

describe('DeviceManagerStore', () => {
  let sandbox, store;
  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    store = new DeviceManagerStore();
  });
  afterEach(() => {
    sandbox.restore();
  });

  describe('#_onFlowFileChangedFunc()', () => {
    it('should do nothing unless the flow file is modified', done => {
      let promise = sandbox.stub(new Promise());
      promise.then.yields(false); // modified = false
      sandbox.stub(store.deviceState, 'loadAndSetFlowSignature').returns(promise);
      store.deviceState.onFlowFileChanged().then(() => {
        done();
      }).catch(err => {
        done(err);
      });
    });

    it('should publish a command when the flow file is modified', done => {
      let promise = sandbox.stub(new Promise());
      promise.then.onFirstCall().yields(true).returns(promise); // modified = true
      promise.then.onSecondCall().yields(); // Promise.all()
      promise.then.onThirdCall().yields(); // publish
      let listenerConfig = sandbox.stub({
        registerInputNode: () => {}
      });
      let accountConfig = {
        accountFqn: 'TEST@localhost'
      };
      let manager = sandbox.stub(new DeviceManager(false, listenerConfig, accountConfig, new DeviceState()));
      assert.isTrue(listenerConfig.registerInputNode.calledOnce);
      store.store[accountConfig.accountFqn] = manager;
      manager.publish.returns(promise);

      sandbox.stub(store.deviceState, 'loadAndSetFlowSignature').returns(promise);
      store.deviceState.onFlowFileChanged().then(() => {
        assert.isTrue(manager.publish.calledOnce);
        done();
      }).catch(err => {
        done(err);
      });
    });
  });

  describe('#_onFlowFileRemovedFunc()', () => {
    it('should NOT publish a command when deviceState.flowFileSignature exists', done => {
      let promise = sandbox.stub(new Promise());
      promise.then.yields();
      let listenerConfig = sandbox.stub({
        registerInputNode: () => {}
      });
      let accountConfig = {
        accountFqn: 'TEST@localhost'
      };
      let manager = sandbox.stub(new DeviceManager(false, listenerConfig, accountConfig, new DeviceState()));
      assert.isTrue(listenerConfig.registerInputNode.calledOnce);
      store.store[accountConfig.accountFqn] = manager;
      manager.publish.returns(promise);

      store.deviceState.onFlowFileRemoved().then(() => {
        assert.isFalse(manager.publish.calledOnce);
        done();
      }).catch(err => {
        done(err);
      });
    });

    it('should publish a command when deviceState.flowFileSignature exists', done => {
      let promise = sandbox.stub(new Promise());
      promise.then.yields();
      store.deviceState.flowFileSignature = 'test';

      let listenerConfig = sandbox.stub({
        registerInputNode: () => {}
      });
      let accountConfig = {
        accountFqn: 'TEST@localhost'
      };
      let manager = sandbox.stub(new DeviceManager(true, listenerConfig, accountConfig, new DeviceState()));
      assert.isTrue(listenerConfig.registerInputNode.calledOnce);
      store.store[accountConfig.accountFqn] = manager;
      manager.publish.returns(promise);

      let listenerConfig2 = sandbox.stub({
        registerInputNode: () => {}
      });
      let accountConfig2 = {
        accountFqn: 'TEST2@localhost'
      };
      let manager2 = sandbox.stub(new DeviceManager(false, listenerConfig2, accountConfig2, new DeviceState()));
      assert.isTrue(listenerConfig2.registerInputNode.calledOnce);
      store.store[accountConfig2.accountFqn] = manager2;

      store.deviceState.onFlowFileRemoved().then(() => {
        assert.isTrue(manager.publish.calledOnce);
        done();
      }).catch(err => {
        done(err);
      });
    });
  });

  describe('#initWsClient()', () => {
    it('should initialize a websocket client as a primary device manager client', done => {
      let account = {};
      let listenerConfig = sandbox.stub({
        registerInputNode: () => {}
      });
      let accountConfig = sandbox.stub({
        accountFqn: 'TEST@localhost',
        on: () => {}
      });
      let webSocketListeners = sandbox.stub({
        get: () => {}
      });
      webSocketListeners.get.returns(listenerConfig);
      assert.isFalse(store.isWsClientInitialized(accountConfig.accountFqn));
      store.initWsClient(account, accountConfig, webSocketListeners);
      assert.isTrue(store.isWsClientInitialized(accountConfig.accountFqn));
      assert.isTrue(store.store[accountConfig.accountFqn].primary);
      store.initWsClient(account, accountConfig, webSocketListeners);
      assert.equal(1, Object.keys(store.store).length);
      done();
    });

    it('should initialize a websocket client as NOT a primary device manager client', done => {
      let account = {};
      let listenerConfig = sandbox.stub({
        registerInputNode: () => {}
      });
      let accountConfig = sandbox.stub({
        accountFqn: 'TEST@localhost',
        on: () => {}
      });
      let webSocketListeners = sandbox.stub({
        get: () => {}
      });
      webSocketListeners.get.returns(listenerConfig);
      store.initWsClient(account, accountConfig, webSocketListeners);
      assert.isTrue(store.store[accountConfig.accountFqn].primary);

      let accountConfig2 = sandbox.stub({
        accountFqn: 'TEST2@localhost',
        on: () => {}
      });
      assert.isFalse(store.isWsClientInitialized(accountConfig2.accountFqn));
      store.initWsClient(account, accountConfig2, webSocketListeners);
      assert.isTrue(store.isWsClientInitialized(accountConfig2.accountFqn));
      assert.equal(2, Object.keys(store.store).length);
      assert.isNotTrue(store.store[accountConfig2.accountFqn].primary);
      done();
    });
  });
});
