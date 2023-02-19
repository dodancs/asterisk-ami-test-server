/**
 * Developer: BelirafoN
 * Date: 13.04.2016
 * Time: 15:26
 */

// const net = require("net");
// const shortId = require("shortid");
// const EventEmitter = require("events").EventEmitter;
// const amiUtils = require("asterisk-ami-event-utils");
// const amiDataStream = require("asterisk-ami-events-stream");

import { AmiEvent, AmiEventsStream } from "@dodancs/asterisk-ami-events-stream";
import amiUtils from "@dodancs/asterisk-ami-event-utils";
import { EventEmitter } from "events";
import * as net from "net";
import * as shortId from "shortid";

import * as meta from "../package.json";
const CRLF = "\r\n";

interface AmiSocket extends net.Socket {
    _authTimer: NodeJS.Timeout | null;
    _eventStream: AmiEventsStream;
    _key: string;
}

/**
 * AmiTestServer
 */
export class AmiTestServer extends EventEmitter {

    /**
     *
     * @param clients
     * @returns {*}
     */
    public static objectValues(clients: Record<string, AmiSocket>) {
        return Object.keys(clients).reduce((clientsArr: AmiSocket[], key: string) => {
            clientsArr.push(clients[key]);
            return clientsArr;
        }, []);
    }

    /**
     *
     * @param clientSocket
     * @param message
     */
    public static sendToClient(clientSocket: AmiSocket, message: AmiEvent) {
        clientSocket.write(amiUtils.fromObject(message));
    }

    private _authClients: Record<string, AmiSocket> = {};
    private _server: net.Server;
    private _unAuthClients: Record<string, AmiSocket> = {};
    private _options: Record<string, any> = {};
    private _helloMessage: string = "";

    constructor(options?: Record<string, any>) {
        super();

        this._helloMessage = `Asterisk AMI Test Server ${meta.version}`;
        this._options = {
            authTimeout: 30000,
            credentials: {},
            maxConnections: 50,
            silent: false,
            ...(options || {})
        };
        this._server = net.createServer();
    }

    public broadcast(data: string): this {
        Object.keys(this._authClients).forEach((key) => {
            this._authClients[key].write(data);
        });
        return this;
    }

    public listen(port: number): Promise<AmiTestServer> {
        return new Promise((resolve, reject) => {
            return new Promise((resolve1: (value: AmiTestServer) => void, reject1) => {
                this._server.on("error", (error: Error | string) => {
                    reject1(error);
                });
                this._server.listen(port, '0.0.0.0', () => {
                    if (!this._options.silent) {
                        const addr = this._server.address();
                        const binding = typeof addr === 'string'
                            ? `pipe/socket ${addr}`
                            : `port ${addr?.port}`;
                        console.log(`Asterisk AMI Test Server listening on ${binding} port`);
                    }

                    this._server
                        .on("close", this.close.bind(this))
                        .on("connection", this._connectionHandler.bind(this))
                        .on("error", (error: string) => {
                            this.emit(error);
                        })
                        .on("listening", () => this.emit("listening"));

                    resolve1(this);
                });
            })
                .then(resolve)
                .catch((error) => {
                    this._server.removeAllListeners("error");
                    if (error instanceof Error) {
                        reject(error);
                    }
                });
        });
    }

    /**
     *
     * @returns {AmiTestServer}
     */
    public close() {
        this.getClients().forEach((client: AmiSocket) => {
            client.end();
            client.destroy();
            if (client._authTimer !== null) {
                clearTimeout(client._authTimer);
                client._authTimer = null;
            }
        });
        this._authClients = {};
        this._unAuthClients = {};
        if (this._server) {
            this._server.close();
            this._server.removeAllListeners();
        }
        this.emit("close");
        return this;
    }

    /**
     *
     * @returns {*}
     */
    public getAuthClients() {
        return AmiTestServer.objectValues(this._authClients);
    }

    /**
     *
     * @returns {*}
     */
    public getUnAuthClients() {
        return AmiTestServer.objectValues(this._unAuthClients);
    }

    /**
     *
     * @returns {Array.<T>}
     */
    public getClients() {
        return (new Array<AmiSocket>).concat(this.getAuthClients(), this.getUnAuthClients());
    }

    /**
     *
     * @param login
     * @param password
     * @returns {boolean}
     * @private
     */
    private _isAttempt(login: string | undefined | null, password: string | undefined | null) {
        const credentials = this._options.credentials;
        return !credentials ||
            !credentials.username ||
            credentials.username.toString().length &&
            credentials.username === login &&
            credentials.secret.toString().length &&
            credentials.secret === password;
    }

    /**
     *
     * @returns {boolean}
     * @private
     */
    private _isAllowConnection() {
        return !(this._options.maxConnections === 0 || this.getClients().length >= this._options.maxConnections);
    }

    /**
     *
     * @param clientSocket
     * @private
     */
    private _connectionHandler(clientSocket: AmiSocket) {
        if (!this._isAllowConnection()) {
            console.debug(`Connection rejected. Clients count: ${Object.keys(this._authClients).length}, maxConnections: ${this._options.maxConnections}`);
            clientSocket.end();
            clientSocket.destroy();
            return;
        }

        clientSocket._authTimer = null;
        clientSocket._eventStream = new AmiEventsStream();
        clientSocket._key = shortId.generate();

        this._unAuthClients[clientSocket._key] = clientSocket;

        clientSocket
            .on("close", () => {
                if (clientSocket._eventStream) {
                    clientSocket.unpipe(clientSocket._eventStream);
                }
                if (clientSocket._authTimer !== null) {
                    clearTimeout(clientSocket._authTimer);
                    clientSocket._authTimer = null;
                }
                delete this._authClients[clientSocket._key];
                delete this._unAuthClients[clientSocket._key];
                console.debug(`[key:${clientSocket._key}]`, 'Client disconnected.');
            })
            .on("error", (error) => {
                if (clientSocket._eventStream) {
                    clientSocket.unpipe(clientSocket._eventStream);
                }
                if (clientSocket._authTimer !== null) {
                    clearTimeout(clientSocket._authTimer);
                    clientSocket._authTimer = null;
                }
                delete this._authClients[clientSocket._key];
                console.debug(`[key:${clientSocket._key}]`, `Client connection error: ${error.message}.`);
            })
            .pipe(clientSocket._eventStream);

        clientSocket._authTimer = setTimeout((clientSocket1) => {
            console.debug(`[key:${clientSocket1._key}]`, 'Client failed to authenticate.');
            clientSocket1.unpipe(clientSocket1._eventStream);
            clientSocket1.end();
            clientSocket1.destroy();
            delete this._unAuthClients[clientSocket1._key];
        }, this._options.authTimeout, clientSocket);

        clientSocket._eventStream.on("amiAction", (action) => this._amiActionHandler(action, clientSocket));
        console.debug(`[key:${clientSocket._key}]`, 'Client\'s connection established.');
    }

    /**
     *
     * @param action
     * @param clientSocket
     * @private
     */
    private _authHandler(action: AmiEvent, clientSocket: AmiSocket) {
        let actionName: string | null = null;
        const responseData = action.ActionID ? { ActionID: action.ActionID } : {};

        if (action && action.Action) {
            actionName = action.Action.toLowerCase();
        }

        if (actionName !== "login" || !this._isAttempt(action.Username, action.Secret)) {
            if (clientSocket._authTimer !== null) {
                clearTimeout(clientSocket._authTimer);
                clientSocket._authTimer = null;
            }

            AmiTestServer.sendToClient(clientSocket, {
                Response: "Error",
                Message: "Authentication failed",
                ...responseData
            });
            return;
        }

        if (clientSocket._authTimer !== null) {
            clearTimeout(clientSocket._authTimer);
            clientSocket._authTimer = null;
        }

        AmiTestServer.sendToClient(clientSocket, {
            Response: "Success",
            Message: "Authentication accepted",
            ...responseData
        });

        AmiTestServer.sendToClient(clientSocket, {
            Event: "FullyBooted",
            Privilege: "system,all",
            Status: "Fully Booted"
        });

        this._authClients[clientSocket._key] = clientSocket;
        delete this._unAuthClients[clientSocket._key];
        if (this._helloMessage) {
            clientSocket.write(this._helloMessage + CRLF);
        }

        const authClientsCount = Object.keys(this._authClients).length;
        this.emit("connection", authClientsCount);
        console.debug(`[key:${clientSocket._key}]`, `Client authorized. Clients count: ${authClientsCount}`);
    }

    /**
     *
     * @param action
     * @param clientSocket
     * @private
     */
    private _amiActionHandler(action: AmiEvent, clientSocket: AmiSocket) {
        let actionName = null;
        const responseData = action.ActionID ? { ActionID: action.ActionID } : {};

        console.debug(action);

        if (action && action.Action) {
            actionName = action.Action.toLowerCase();
            console.debug(actionName);
        }

        if (!action || !actionName) {
            AmiTestServer.sendToClient(clientSocket, {
                Response: "Error",
                Message: "Missing action in request",
                ...responseData
            });
            return;
        }

        if (actionName === "ping") {
            AmiTestServer.sendToClient(clientSocket, {
                Response: "Success",
                Ping: "Pong",
                Timestamp: Date.now() / 1000 + "000",
                ...(action.ActionID ? { ActionID: action.ActionID } : {})
            });
            return;
        }

        if (actionName !== "login" && actionName !== "logoff") {
            AmiTestServer.sendToClient(clientSocket, {
                Response: "Error",
                Message: "Invalid/unknown command",
                ...responseData
            });
            return;
        }

        if (this._authClients[clientSocket._key]) {

            if (actionName === "logoff") {
                if (clientSocket._authTimer !== null) {
                    clearTimeout(clientSocket._authTimer);
                    clientSocket._authTimer = null;
                }
                AmiTestServer.sendToClient(clientSocket, {
                    Response: "Goodbye",
                    Message: "Thanks for all the fish.",
                    ...(action.ActionID ? { ActionID: action.ActionID } : {})
                });
            }

        } else {
            this._authHandler(action, clientSocket);
        }
    }

}
