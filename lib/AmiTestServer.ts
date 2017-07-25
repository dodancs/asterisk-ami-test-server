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

import debug from "debug";
import {EventEmitter} from "events";
import amiUtils from "local-asterisk-ami-event-utils";
import AmiEventsStream from "local-asterisk-ami-events-stream";
import * as net from "net";
import shortId = require("shortid");

const debugLog = debug("AmiTestServer");
const errorLog = debug("AmiTestServer:error");

const meta = require("../package.json");
const CRLF = "\r\n";


/**
 * AmiTestServer
 */
class AmiTestServer extends EventEmitter {

    /**
     *
     * @param clients
     * @returns {*}
     */
    public static objectValues(clients) {
        return Object.keys(clients).reduce((clientsArr, key) => {
            clientsArr.push(clients[key]);
            return clientsArr;
        }, []);
    }

    /**
     *
     * @param clientSocket
     * @param message
     */
    public static sendToClient(clientSocket, message) {
        clientSocket.write(amiUtils.fromObject(message));
    }

    private _authClients: {};
    private _server: any;
    private _unAuthClients: {};
    private _options: any;
    private _helloMessage: string;

    constructor(options) {
        super();

        Object.assign(this, {
            _authClients: {},
            _helloMessage: `Asterisk AMI Test Server ${meta.version}`,
            _options: {
                authTimeout: 30000,
                credentials: {},
                maxConnections: 50,
                silent: false,
                ...(options || {})
            },
            _server: net.createServer(),
            _unAuthClients: {}
        });
    }

    public broadcast(data): this {
        Object.keys(this._authClients).forEach((key) => {
            this._authClients[key].write(data);
        });
        return this;
    }

    public listen(port): Promise<AmiTestServer> {
        return new Promise((resolve, reject) => {
            return new Promise((resolve1, reject1) => {
                this._server.on("error", (error) => {
                    reject1(error);
                });
                this._server.listen(port, () => {
                    if (!this._options.silent) {
                        console.log(`Asterisk AMI Test Server listening on ${this._server.address().port} port`);
                    }

                    this._server
                        .on("close", this.close.bind(this))
                        .on("connection", this._connectionHandler.bind(this))
                        .on("error", (error) => {
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
        this.getClients().forEach((client) => {
            if (client instanceof net.Socket) {
                client.end();
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
        return [].concat(this.getAuthClients(), this.getUnAuthClients());
    }

    /**
     *
     * @param login
     * @param password
     * @returns {boolean}
     * @private
     */
    private _isAttempt(login, password) {
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
    private _connectionHandler(clientSocket) {
        if (!this._isAllowConnection()) {
            debugLog(`Connection rejected. Clients count: ${Object.keys(this._authClients).length}, maxConnections: ${this._options.maxConnections}`);
            clientSocket.end();
            return;
        }

        Object.assign(clientSocket, {
            _authTimer: null,
            _eventStream: new AmiEventsStream(),
            _key: shortId.generate()
        });

        this._unAuthClients[clientSocket._key] = clientSocket;

        clientSocket
            .on("close", () => {
                if (clientSocket._eventStream) {
                    clientSocket.unpipe(clientSocket._eventStream);
                }
                delete this._authClients[clientSocket._key];
                delete this._unAuthClients[clientSocket._key];
                debugLog(`Client disconnected [key:${clientSocket._key}].`);
            })
            .on("error", (error) => {
                if (clientSocket._eventStream) {
                    clientSocket.unpipe(clientSocket._eventStream);
                }
                delete this._authClients[clientSocket._key];
                debugLog(`Client connection error [key:${clientSocket._key}]: ${error.message}.`);
            })
            .pipe(clientSocket._eventStream);

        clientSocket._authTimer = setTimeout((clientSocket1) => {
            clientSocket1.unpipe(clientSocket1._eventStream);
            clientSocket1.end();
            delete this._unAuthClients[clientSocket1._key];
        }, this._options.authTimeout, clientSocket);

        clientSocket._eventStream.on("amiAction", (action) => this._amiActionHandler(action, clientSocket));
        debugLog(`Client's connect established [key:${clientSocket._key}].`);
    }

    /**
     *
     * @param action
     * @param clientSocket
     * @private
     */
    private _authHandler(action, clientSocket) {
        let actionName = null;
        const responseData = action.ActionID ? {ActionID: action.ActionID} : {};

        if (action && action.Action) {
            actionName = action.Action.toLowerCase();
        }

        if (actionName !== "login" || !this._isAttempt(action.Username, action.Secret)) {
            clearTimeout(clientSocket._authTimer);
            AmiTestServer.sendToClient(clientSocket, {
                Message: "Authentication failed",
                Response: "Error",
                ...responseData
            });
            return;
        }

        clearTimeout(clientSocket._authTimer);

        AmiTestServer.sendToClient(clientSocket, {
            Message: "Authentication accepted",
            Response: "Success",
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
        debugLog(`Client authorized [key:${clientSocket._key}]. Clients count: ${authClientsCount}`);
    }

    /**
     *
     * @param action
     * @param clientSocket
     * @private
     */
    private _amiActionHandler(action, clientSocket) {
        let actionName = null;
        const responseData = action.ActionID ? {ActionID: action.ActionID} : {};

        if (action && action.Action) {
            actionName = action.Action.toLowerCase();
        }

        if (!action || !actionName) {
            AmiTestServer.sendToClient(clientSocket, {
                Message: "Missing action in request",
                Response: "Error",
                ...responseData
            });
            return;
        }

        if (actionName === "ping") {
            AmiTestServer.sendToClient(clientSocket, {
                Ping: "Pong",
                Response: "Success",
                Timestamp: Date.now() / 1000 + "000",
                ...(action.ActionID ? {ActionID: action.ActionID} : {})
            });
            return;
        }

        if (actionName !== "login" && actionName !== "logoff") {
            AmiTestServer.sendToClient(clientSocket, {
                Message: "Invalid/unknown command",
                Response: "Error",
                ...responseData
            });
            return;
        }

        if (this._authClients[clientSocket._key]) {

            if (actionName === "logoff") {
                clearTimeout(clientSocket._authTimer);
                AmiTestServer.sendToClient(clientSocket, {
                    Message: "Thanks for all the fish.",
                    Response: "Goodbye",
                    ...(action.ActionID ? {ActionID: action.ActionID} : {})
                });
            }

        } else {
            this._authHandler(action, clientSocket);
        }
    }

}

export default AmiTestServer;
