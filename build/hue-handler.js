"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hue_error_1 = require("hue-emu/dist/error/hue-error");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const uuid = require("uuid");
class HueHandler {
    constructor(adapter) {
        this.adapter = adapter;
    }
    onPairing(req, devicetype, generateclientkey) {
        this.adapter.log.info(`Pairing with devicetype=${devicetype} and generateclientkey=${generateclientkey}`);
        if (!this.adapter.disableAuth && !this.adapter.pairingEnabled) {
            return rxjs_1.throwError(hue_error_1.HueError.LINK_BUTTON_NOT_PRESSED);
        }
        let username;
        if (req.body && req.body.username && typeof req.body.username === 'string' && req.body.username.length > 0) {
            username = req.body.username;
            this.adapter.log.info(`Received username from client=${username}. Using this one`);
        }
        else {
            username = uuid.v4();
        }
        this.addUser(username, devicetype);
        return rxjs_1.of(username);
    }
    addUser(username, devicetype = 'unknown') {
        this.adapter.log.info('create random user id: ' + username);
        this.adapter.setObjectNotExists('user', {
            type: 'meta',
            common: {
                name: 'user',
                read: true,
                write: false
            },
            native: {}
        });
        this.adapter.setObjectNotExists('user.' + username, {
            type: 'state',
            common: {
                name: devicetype,
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: { username: username }
        });
        this.adapter.setState('user.' + username, {
            ack: true, val: username
        });
    }
    onLights(req, username) {
        return this.checkUserAuthenticated(username).pipe(operators_1.switchMap(() => {
            return new rxjs_1.Observable(subscriber => {
                const lights = {};
                this.adapter.getDevices((err, channelObjects) => {
                    if (!err && channelObjects) {
                        const observables = [];
                        channelObjects.forEach(value => {
                            const lightId = value._id.substr(this.adapter.namespace.length + 1);
                            // this.log.info(lightId);
                            observables.push(this.onLight(req, username, lightId).pipe(operators_1.map(light => {
                                return { id: lightId, light: light };
                            })));
                        });
                        rxjs_1.merge(...observables).subscribe((value) => {
                            lights[value.id] = value.light;
                        }, error => {
                            // TODO: ???
                        }, () => {
                            subscriber.next(lights);
                            subscriber.complete();
                        });
                    }
                    else {
                        subscriber.next(lights);
                        subscriber.complete();
                    }
                });
            });
        }));
    }
    onLight(req, username, lightId) {
        return this.checkUserAuthenticated(username).pipe(operators_1.switchMap(() => {
            return new rxjs_1.Observable(subscriber => {
                this.adapter.getStatesOf(lightId, 'state', (stateObjectsErr, stateObjects) => {
                    if (!stateObjectsErr && stateObjects) {
                        // this.log.info('stateObject length: ' + stateObjects.length);
                        // this.log.info('found channel: ' + JSON.stringify(stateObjects));
                        const observables = [];
                        stateObjects.forEach(stateObject => {
                            // this.log.info('iter: ' + stateObject._id);
                            observables.push(new rxjs_1.Observable(stateObjectSubscriber => {
                                const id = stateObject._id.substr(this.adapter.namespace.length + 1);
                                // this.log.info('search state: ' + id);
                                this.adapter.getState(id, (err, state) => {
                                    if (!err && state) {
                                        // this.log.info('found state: ' + stateObject._id);
                                        stateObjectSubscriber.next({
                                            id: stateObject._id.substr(stateObject._id.lastIndexOf('.') + 1),
                                            val: state.val
                                        });
                                        stateObjectSubscriber.complete();
                                    }
                                    else {
                                        // this.log.info('could not load state: ' + stateObject._id);
                                        stateObjectSubscriber.complete();
                                    }
                                });
                            }));
                        });
                        const light = {
                            state: {}
                        };
                        if (observables.length === 0) {
                            // well the light should at least have one state value. Otherwise this makes no sense
                            // this.log.info('observables is empty');
                            subscriber.error(hue_error_1.HueError.RESOURCE_NOT_AVAILABLE.withParams(lightId));
                        }
                        rxjs_1.merge(...observables).subscribe((value) => {
                            // this.log.info('iter merged obs: ' + JSON.stringify(value));
                            light.state[value.id] = value.val;
                        }, err => {
                            // TODO: ???
                        }, () => {
                            this.adapter.getState(lightId + '.name', (nameErr, nameState) => {
                                if (!nameErr && nameState) {
                                    light['name'] = nameState.val;
                                    this.adapter.getState(lightId + '.data', (dataErr, dataState) => {
                                        if (!dataErr && dataState) {
                                            Object.keys(dataState.val).forEach((dataKey) => {
                                                light[dataKey] = dataState.val[dataKey];
                                            });
                                            subscriber.next(light);
                                            subscriber.complete();
                                        }
                                        else {
                                            // this.log.info('Could not load data');
                                            subscriber.error(hue_error_1.HueError.RESOURCE_NOT_AVAILABLE.withParams(lightId));
                                        }
                                    });
                                }
                                else {
                                    // this.log.info('Could not load data');
                                    subscriber.error(hue_error_1.HueError.RESOURCE_NOT_AVAILABLE.withParams(lightId));
                                }
                            });
                        });
                    }
                    else {
                        // this.log.info('found absolutely no state channel');
                        subscriber.error(hue_error_1.HueError.RESOURCE_NOT_AVAILABLE.withParams(lightId));
                    }
                });
            });
        }));
    }
    onLightsState(req, username, lightId, key, value) {
        return this.checkUserAuthenticated(username).pipe(operators_1.switchMap(() => {
            return new rxjs_1.Observable(subscriber => {
                this.adapter.getStatesOf(lightId, 'state', (stateObjectsErr, stateObjects) => {
                    if (!stateObjectsErr && stateObjects) {
                        stateObjects.forEach(stateObject => {
                            const id = stateObject._id.substr(this.adapter.namespace.length + 1);
                            const lightKey = stateObject._id.substr(stateObject._id.lastIndexOf('.') + 1);
                            // this.log.info('onState: ' + id);
                            if (lightKey === key) {
                                this.adapter.setState(id, {
                                    val: value, ack: true
                                }, (err, id) => {
                                    if (!err) {
                                        this.onLight(req, username, lightId).subscribe(light => {
                                            subscriber.next(light);
                                            subscriber.complete();
                                        }, error => {
                                            subscriber.error(hue_error_1.HueError.RESOURCE_NOT_AVAILABLE.withParams(lightId));
                                        });
                                    }
                                    else {
                                        subscriber.error(hue_error_1.HueError.RESOURCE_NOT_AVAILABLE.withParams(lightId));
                                    }
                                });
                            }
                        });
                    }
                    else {
                        subscriber.error(hue_error_1.HueError.RESOURCE_NOT_AVAILABLE.withParams(lightId));
                    }
                });
            });
        }));
    }
    onConfig(req) {
        return rxjs_1.of({
            name: 'Philips hue',
            datastoreversion: '90',
            swversion: '1937045000',
            apiversion: '1.36.0',
            mac: this.adapter.config.mac,
            bridgeid: this.getBridgeId(),
            factorynew: false,
            replacesbridgeid: null,
            modelid: 'BSB002',
            starterkitid: ''
        });
    }
    onAll(req, username) {
        return this.checkUserAuthenticated(username).pipe(operators_1.switchMap(() => {
            return this.onLights(req, username).pipe(operators_1.map(lights => {
                const result = {};
                result['lights'] = JSON.parse(JSON.stringify(lights));
                result['groups'] = {};
                result['config'] = {
                    name: 'Philips hue',
                    datastoreversion: '90',
                    swversion: '1937045000',
                    apiversion: '1.36.0',
                    mac: this.adapter.config.mac,
                    bridgeid: this.getBridgeId(),
                    factorynew: false,
                    replacesbridgeid: null,
                    modelid: 'BSB002',
                    starterkitid: '',
                    ipaddress: this.adapter.config.discoveryHost // May be checked by some clients. May also be a valid value
                };
                result['schedules'] = {};
                result['scenes'] = {};
                result['rules'] = {};
                result['sensors'] = {};
                result['resourcelinks'] = {};
                return result;
            }));
        }));
    }
    onFallback(req, res) {
        this.adapter.log.warn('Request not handled by adapter: ' + req.url);
        return rxjs_1.of({});
    }
    getBridgeId() {
        let result = '';
        for (let i = 0; i < 16; i++) {
            result += this.adapter.instance;
        }
        return result;
    }
    checkUserAuthenticated(username) {
        return new rxjs_1.Observable(subscriber => {
            this.adapter.getStatesOf('user', (err, stateObj) => {
                if (this.adapter.disableAuth) {
                    subscriber.next(true);
                    subscriber.complete();
                    return;
                }
                if (!err && stateObj) {
                    let found = false;
                    stateObj.forEach(value => {
                        const id = value._id.substr(this.adapter.namespace.length + 6); // 1 + 'user.'
                        if (id === username) {
                            found = true;
                        }
                    });
                    if (found) {
                        this.adapter.log.debug(`Found authenticated username=${username}`);
                        subscriber.next(true);
                        subscriber.complete();
                    }
                    else {
                        this.adapter.log.debug(`Could not find authenticated username=${username}`);
                        if (this.adapter.pairingEnabled) {
                            // Amazon Echo is nuts they call pairing endpoint
                            // but then call other method with different user.
                            // during pairing we allow that...
                            this.adapter.log.debug(`Pairing enabled and user not authenticated yet. Adding user with: ${username}`);
                            this.addUser(username);
                            subscriber.next(true);
                            subscriber.complete();
                        }
                        else {
                            subscriber.error(hue_error_1.HueError.UNAUTHORIZED_USER);
                        }
                    }
                }
            });
        });
    }
}
exports.HueHandler = HueHandler;
