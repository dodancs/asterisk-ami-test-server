/**
 * Developer: BelirafoN
 * Date: 04.05.2016
 * Time: 12:45
 */

import * as assert from "assert";
import * as net from "net";
import { AmiTestServer } from "../src/AmiTestServer";

const CRLF = "\r\n";

process.on("unhandledRejection", (err) => {
    assert.ifError(err);
});

describe("AmiTestServer internal functionality", function () {
    this.timeout(process.env.MOCHA_TIMEOUT || 2000);

    let server: AmiTestServer;
    let client: net.Socket;
    let optionsDefault: Record<string, any> = {};
    const defaultPort: number = 5038;

    beforeEach(() => {
        optionsDefault = {
            authTimeout: 30000,
            credentials: {
                secret: "test",
                username: "test"
            },
            maxConnections: 50,
            silent: true
        };
        server = new AmiTestServer(optionsDefault);
    });

    afterEach(() => {
        if (server instanceof AmiTestServer) {
            server.close();
        }
        if (client && client instanceof net.Socket) {
            client.destroy();
            client.removeAllListeners();
        }
    });

    it(`Listening on port ${defaultPort}`, (done) => {
        server.listen(defaultPort)
            .then(() => {
                client = net.connect(defaultPort, 'localhost', done);
            })
            .catch((error: Error | string) => {
                done(error);
            });
    });

    it("Auth disconnect by timeout", (done) => {
        optionsDefault.authTimeout = 1000;
        server = new AmiTestServer(optionsDefault);
        server.listen(defaultPort).then(() => {
            let isConnected = false;
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                isConnected = true;
            });
            client.on("close", () => {
                if (isConnected) {
                    done();
                }
            });
        });
    });

    it("Check limit of authClients", (done) => {
        optionsDefault.maxConnections = 1;
        server = new AmiTestServer(optionsDefault);

        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                const client2 = net.connect({ port: defaultPort, host: 'localhost' });
                client2
                    .on("close", () => {
                        client2.destroy();
                        client2.removeAllListeners();
                        done();
                    })
                    .on("error", () => {
                        client2.destroy();
                        client2.removeAllListeners();
                    });
            });
        });
    });

    it("Auth with correct credentials", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Success/.test(chunk.toString())) {
                            done();
                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: ${optionsDefault.credentials.username}`,
                        `Secret: ${optionsDefault.credentials.secret}`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Auth with incorrect credentials", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Error/.test(chunk.toString())) {
                            done();
                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: username`,
                        `Secret: secret`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Get server authClients", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Success/.test(chunk.toString())) {
                            assert.equal(server.getAuthClients().length, 1);
                            done();
                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: ${optionsDefault.credentials.username}`,
                        `Secret: ${optionsDefault.credentials.secret}`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Get server unAuthClients", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                setTimeout(() => {
                    assert.equal(server.getUnAuthClients().length, 1);
                    done();
                }, 1);
            });
        });
    });

    it("Get server total clients", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Success/.test(chunk.toString())) {

                            const client2 = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                                setTimeout(() => {
                                    assert.equal(server.getClients().length, 2);
                                    client2.destroy();
                                    client2.removeAllListeners();
                                    done();
                                }, 1);
                            });

                            client2.on("error", () => {
                                client2.destroy();
                                client2.removeAllListeners();
                            });
                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: ${optionsDefault.credentials.username}`,
                        `Secret: ${optionsDefault.credentials.secret}`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Ping action before auth", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        const str = chunk.toString();
                        assert.ok(/Response: Success/.test(str));
                        assert.ok(/Ping: Pong/.test(str));
                        assert.ok(/ActionID: testID/.test(str));
                        // assert.ok(/Timestamp: \d{10}\.\d{6}/.test(str));
                        done();
                    }).write([
                        "Action: Ping",
                        "ActionID: testID"
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Ping action after auth", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Success/.test(chunk.toString())) {

                            client
                                .once("data", (chunk1) => {
                                    const str = chunk1.toString();
                                    assert.ok(/Response: Success/.test(str));
                                    assert.ok(/Ping: Pong/.test(str));
                                    assert.ok(/ActionID: testID/.test(str));
                                    // assert.ok(/Timestamp: \d{10}\.\d{6}/.test(str));
                                    done();
                                })
                                .write([
                                    "Action: Ping",
                                    "ActionID: testID"
                                ].join(CRLF) + CRLF.repeat(2));

                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: ${optionsDefault.credentials.username}`,
                        `Secret: ${optionsDefault.credentials.secret}`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Logoff action", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Success/.test(chunk.toString())) {

                            client
                                .once("data", (chunk1) => {
                                    const str = chunk1.toString();
                                    assert.equal(str, [
                                        "Response: Goodbye",
                                        "Message: Thanks for all the fish.",
                                        "ActionID: logoff_123"
                                    ].join(CRLF) + CRLF.repeat(2));
                                    done();
                                })
                                .write([
                                    "Action: Logoff",
                                    "ActionID: logoff_123"
                                ].join(CRLF) + CRLF.repeat(2));

                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: ${optionsDefault.credentials.username}`,
                        `Secret: ${optionsDefault.credentials.secret}`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Action without name (empty)", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Success/.test(chunk.toString())) {

                            client
                                .once("data", (chunk1) => {
                                    const str = chunk1.toString();
                                    assert.equal(str, [
                                        "Response: Error",
                                        "Message: Missing action in request",
                                        "ActionID: empty_123"
                                    ].join(CRLF) + CRLF.repeat(2));
                                    done();
                                })
                                .write([
                                    "Action: ",
                                    "ActionID: empty_123"
                                ].join(CRLF) + CRLF.repeat(2));

                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: ${optionsDefault.credentials.username}`,
                        `Secret: ${optionsDefault.credentials.secret}`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Not support action", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Success/.test(chunk.toString())) {

                            client
                                .once("data", (chunk1) => {
                                    const str = chunk1.toString();
                                    assert.equal(str, [
                                        "Response: Error",
                                        "Message: Invalid/unknown command",
                                        "ActionID: nosupport_123"
                                    ].join(CRLF) + CRLF.repeat(2));
                                    done();
                                })
                                .write([
                                    "Action: nosupport",
                                    "ActionID: nosupport_123"
                                ].join(CRLF) + CRLF.repeat(2));

                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: ${optionsDefault.credentials.username}`,
                        `Secret: ${optionsDefault.credentials.secret}`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

    it("Server broadcast event", (done) => {
        server.listen(defaultPort).then(() => {
            client = net.connect({ port: defaultPort, host: 'localhost' }, () => {
                client
                    .once("data", (chunk) => {
                        if (/Response: Success/.test(chunk.toString())) {

                            client.once("data", (chunk1) => {
                                const str = chunk1.toString();
                                assert.equal(str, "Event: TestEvent" + CRLF.repeat(2));
                                done();
                            });
                            server.broadcast("Event: TestEvent" + CRLF.repeat(2));
                        }
                    })
                    .write([
                        "Action: Login",
                        `Username: ${optionsDefault.credentials.username}`,
                        `Secret: ${optionsDefault.credentials.secret}`
                    ].join(CRLF) + CRLF.repeat(2));
            });
        });
    });

});
