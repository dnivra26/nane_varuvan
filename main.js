'use strict';

import React, {Component} from 'react';
import {
    AppRegistry,
    StyleSheet,
    Text,
    TouchableHighlight,
    Button,
    View,
    Dimensions,
    TextInput,
    ListView,
    DeviceEventEmitter,
} from 'react-native';
import {SensorManager, TiltActivity, UsbSerial} from 'NativeModules';
import io from 'socket.io-client/dist/socket.io';
import {NativeEventEmitter} from 'react-native';

const socket = io.connect('https://react-native-webrtc.herokuapp.com', {transports: ['websocket']});

import {
    RTCPeerConnection,
    RTCMediaStream,
    RTCIceCandidate,
    RTCSessionDescription,
    RTCView,
    MediaStreamTrack,
    getUserMedia,
} from 'react-native-webrtc';
import ReactNativeHeading from 'react-native-heading';

const configuration = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};

const pcPeers = {};
let localStream;

function getLocalStream(isFront, callback) {
    MediaStreamTrack.getSources(sourceInfos => {
        console.log(sourceInfos);
        let videoSourceId;
        for (let i = 0; i < sourceInfos.length; i++) {
            const sourceInfo = sourceInfos[i];
            if (sourceInfo.kind == "video" && sourceInfo.facing == (isFront ? "front" : "back")) {
                videoSourceId = sourceInfo.id;
            }
        }
        getUserMedia({
            audio: true,
            video: {
                mandatory: {
                    minWidth: 1280, // Provide your own width, height and frame rate here
                    minHeight: 720,
                    minFrameRate: 30
                },
                facingMode: (isFront ? "user" : "environment"),
                optional: (videoSourceId ? [{sourceId: videoSourceId}] : [])
            }
        }, function (stream) {
            console.log('dddd', stream);
            callback(stream);
        }, logError);
    });
}

function join(roomID) {
    socket.emit('join', roomID, function (socketIds) {
        console.log('join', socketIds);
        for (const i in socketIds) {
            const socketId = socketIds[i];
            createPC(socketId, true);
        }
    });
}

function createPC(socketId, isOffer) {
    const pc = new RTCPeerConnection(configuration);
    pcPeers[socketId] = pc;

    pc.onicecandidate = function (event) {
        console.log('onicecandidate', event.candidate);
        if (event.candidate) {
            socket.emit('exchange', {'to': socketId, 'candidate': event.candidate});
        }
    };

    function createOffer() {
        pc.createOffer(function (desc) {
            console.log('createOffer', desc);
            pc.setLocalDescription(desc, function () {
                console.log('setLocalDescription', pc.localDescription);
                socket.emit('exchange', {'to': socketId, 'sdp': pc.localDescription});
            }, logError);
        }, logError);
    }

    pc.onnegotiationneeded = function () {
        console.log('onnegotiationneeded');
        if (isOffer) {
            createOffer();
        }
    };

    pc.oniceconnectionstatechange = function (event) {
        console.log('oniceconnectionstatechange', event.target.iceConnectionState);
        if (event.target.iceConnectionState === 'completed') {
            setTimeout(() => {
                getStats();
            }, 1000);
        }
        if (event.target.iceConnectionState === 'connected') {
            createDataChannel();
        }
    };
    pc.onsignalingstatechange = function (event) {
        console.log('onsignalingstatechange', event.target.signalingState);
    };

    pc.onaddstream = function (event) {
        console.log('onaddstream', event.stream);
        container.setState({info: 'One peer join!'});

        const remoteList = container.state.remoteList;
        remoteList[socketId] = event.stream.toURL();
        container.setState({remoteList: remoteList});
    };
    pc.onremovestream = function (event) {
        console.log('onremovestream', event.stream);
    };

    pc.addStream(localStream);
    function createDataChannel() {
        if (pc.textDataChannel) {
            return;
        }
        const dataChannel = pc.createDataChannel("text");

        dataChannel.onerror = function (error) {
            console.log("dataChannel.onerror", error);
        };

        dataChannel.onmessage = function (event) {
            const message = JSON.parse(event.data);
            // UsbSerial.write(JSON.stringify({s: message['move']*10, v: message['tilt']*25, h: message['rotate']*25}))
            // container.control(message['rotate']);
            // container.control2(message['tilt']);

            console.log("dataChannel.onmessage:", message);
            container.receiveTextData({user: socketId, message: message});
        };

        dataChannel.onopen = function () {
            console.log('dataChannel.onopen');
            container.setState({textRoomConnected: true});
        };

        dataChannel.onclose = function () {
            console.log("dataChannel.onclose");
        };

        pc.textDataChannel = dataChannel;
    }

    return pc;
}

function exchange(data) {
    const fromId = data.from;
    let pc;
    if (fromId in pcPeers) {
        pc = pcPeers[fromId];
    } else {
        pc = createPC(fromId, false);
    }

    if (data.sdp) {
        console.log('exchange sdp', data);
        pc.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {
            if (pc.remoteDescription.type == "offer")
                pc.createAnswer(function (desc) {
                    console.log('createAnswer', desc);
                    pc.setLocalDescription(desc, function () {
                        console.log('setLocalDescription', pc.localDescription);
                        socket.emit('exchange', {'to': fromId, 'sdp': pc.localDescription});
                    }, logError);
                }, logError);
        }, logError);
    } else {
        console.log('exchange candidate', data);
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

function leave(socketId) {
    console.log('leave', socketId);
    const pc = pcPeers[socketId];
    const viewIndex = pc.viewIndex;
    pc.close();
    delete pcPeers[socketId];

    const remoteList = container.state.remoteList;
    delete remoteList[socketId]
    container.setState({remoteList: remoteList});
    container.setState({info: 'One peer leave!'});
}

socket.on('exchange', function (data) {
    exchange(data);
});
socket.on('leave', function (socketId) {
    leave(socketId);
});

socket.on('connect', function (data) {
    console.log('connect');
    getLocalStream(true, function (stream) {
        localStream = stream;
        container.setState({selfViewSrc: stream.toURL()});
        container.setState({status: 'ready', info: 'Please enter or create room ID'});
    });
});

function logError(error) {
    console.log("logError", error);
}

function mapHash(hash, func) {
    const array = [];
    for (const key in hash) {
        const obj = hash[key];
        array.push(func(obj, key));
    }
    return array;
}

function getStats() {
    const pc = pcPeers[Object.keys(pcPeers)[0]];
    if (pc.getRemoteStreams()[0] && pc.getRemoteStreams()[0].getAudioTracks()[0]) {
        const track = pc.getRemoteStreams()[0].getAudioTracks()[0];
        console.log('track', track);
        pc.getStats(track, function (report) {
            console.log('getStats report', report);
        }, logError);
    }
}

let container;
let x;
let y;

const RCTWebRTCDemo = React.createClass({
    getInitialState: function () {
        this.ds = new ListView.DataSource({rowHasChanged: (r1, r2) => true});
        return {
            info: 'Initializing',
            status: 'init',
            roomID: '',
            isFront: true,
            selfViewSrc: null,
            remoteList: {},
            textRoomConnected: false,
            textRoomData: [],
            textRoomValue: '',
        };
    },

    handleData(newTilt) {
        if (this.oldTilt) {
            const diff = this.oldTilt - newTilt;
            const delta = diff > 0 ? diff : -diff;
            if (delta > 5) {
                let res = {
                    "rotate": 0,
                    "move": 0,
                    "tilt": diff
                };
                this.sendMessageToAll(JSON.stringify(res));
                this.oldTilt = newTilt;
            }
        } else {
            this.oldTilt = newTilt;
        }
    },
    control(value) {
      console.log('OUTSIDE: ', x);
      if (!x) {
        console.log('INSIDE');
        fetch('https://api.particle.io/v1/devices/54ff70066678574957410567/horizontal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `access_token=7fd28cacab8033605db7a2b6245c5242a4227665&args=${Number(value)*-20}`,
        }).then(console.log, console.error)

        x = setTimeout(()=> {
          x = null;
        }, 1000);
      }
    },
    control2(value) {
      console.log('OUTSIDE: ', y);
      if (!y) {
        console.log('INSIDE');
        fetch('https://api.particle.io/v1/devices/54ff70066678574957410567/vertical', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `access_token=7fd28cacab8033605db7a2b6245c5242a4227665&args=${Number(value)*-10}`,
        }).then(console.log, console.error)

        y = setTimeout(()=> {
          y = null;
        }, 1000);
      }
    },

    componentDidMount: function () {
        container = this;
        const EVENT_NAME = new NativeEventEmitter(TiltActivity);
        EVENT_NAME.addListener('EVENT_TAG', (message) => this.handleData(message));
        TiltActivity.listenToTheTilt();
        ReactNativeHeading.start(1)
            .then(didStart => {
                this.setState({
                    headingIsSupported: didStart,
                })
            });

        DeviceEventEmitter.addListener('headingUpdated', data => {
            let newHorizontalPosition = JSON.stringify(data);
            if (this.oldHorizontalPosition) {
                const diff = this.oldHorizontalPosition - newHorizontalPosition;
                const delta = diff > 0 ? diff : -diff;
                if (delta > 3) {
                    let res = {
                        "rotate": diff,
                        "move": 0,
                        "tilt": 0
                    };
                    this.sendMessageToAll(JSON.stringify(res));
                    this.oldHorizontalPosition = newHorizontalPosition;
                }
            } else {
                this.oldHorizontalPosition = newHorizontalPosition;
            }
        });

        SensorManager.startStepCounter(1000);
        DeviceEventEmitter.addListener('StepCounter', data => {
            const newPosition = data.steps;
            console.log('New position: ', newPosition);
            if (this.oldPosition) {
                const diff = this.oldPosition - newPosition;
                let res = {
                    "rotate": 0,
                    "move": diff,
                    "tilt": 0
                };
                this.sendMessageToAll(JSON.stringify(res));
            }
            this.oldPosition = newPosition;
        });

    },

    sendMessageToAll(message) {
        for (const key in pcPeers) {
            const pc = pcPeers[key];
            pc.textDataChannel.send(message);
        }
    },
    _press(event) {
        this.refs.roomID.blur();
        this.setState({status: 'connect', info: 'Connecting'});
        join(this.state.roomID);
    },
    _switchVideoType() {
        const isFront = !this.state.isFront;
        this.setState({isFront});
        getLocalStream(isFront, function (stream) {
            if (localStream) {
                for (const id in pcPeers) {
                    const pc = pcPeers[id];
                    pc && pc.removeStream(localStream);
                }
                localStream.release();
            }
            localStream = stream;
            container.setState({selfViewSrc: stream.toURL()});

            for (const id in pcPeers) {
                const pc = pcPeers[id];
                pc && pc.addStream(localStream);
            }
        });
    },
    receiveTextData(data) {
        const textRoomData = this.state.textRoomData.slice();
        textRoomData.push(data);
        this.setState({textRoomData, textRoomValue: ''});
    },
    _textRoomPress() {
        if (!this.state.textRoomValue) {
            return
        }
        const textRoomData = this.state.textRoomData.slice();
        textRoomData.push({user: 'Me', message: this.state.textRoomValue});
        for (const key in pcPeers) {
            const pc = pcPeers[key];
            pc.textDataChannel.send(this.state.textRoomValue);
        }
        this.setState({textRoomData, textRoomValue: ''});
    },
    _renderTextRoom() {
        return (
            <View style={styles.listViewContainer}>
                <ListView
                    dataSource={this.ds.cloneWithRows(this.state.textRoomData)}
                    renderRow={rowData => <Text>{`${rowData.user}: ${rowData.message}`}</Text>}
                />
                <TextInput
                    style={styles.textRoom}
                    onChangeText={value => this.setState({textRoomValue: value})}
                    value={this.state.textRoomValue}
                />
                <TouchableHighlight
                    onPress={this._textRoomPress}>
                    <Text>Send</Text>
                </TouchableHighlight>
            </View>
        );
    },
    render() {
        const {height, width} = Dimensions.get('window');
        return (
            <View style={styles.main}>
                { this.state.status == 'ready' ?
                    (<View style={styles.cameraSection}>
                        <Text>
                            {this.state.isFront ? "Using front camera" : "Using back camera"}
                        </Text>
                        <TouchableHighlight
                            style={styles.cameraToggle}
                            onPress={this._switchVideoType}>
                            <Text>Switch camera</Text>
                        </TouchableHighlight>
                    </View>) : null }
                { this.state.status == 'ready' ?
                    (<View style={styles.cover}>
                        <TextInput
                            ref='roomID'
                            autoCorrect={false}
                            style={styles.room}
                            onChangeText={(text) => this.setState({roomID: text})}
                            value={this.state.roomID}
                        />
                        <Button
                            onPress={this._press}
                            title="JOIN CALL"
                            color="#841584"
                            disabled={!this.state.roomID}
                        />
                    </View>) : null
                }
                {
                    mapHash(this.state.remoteList, function (remote, index) {
                        return (
                            <View style={styles.videoRoom}>
                                <RTCView key={index} streamURL={remote} style={{width: width, height: height / 2}}/>
                                <RTCView key={index + 1} streamURL={remote} style={{width: width, height: height / 2}}/>
                            </View>
                        );
                    })
                }
            </View>
        );
    }
});

const styles = StyleSheet.create({
    main: {padding: 30, flexDirection: 'column', fontSize: 20},
    cover: {alignItems: 'center', justifyContent: 'center'},
    cameraToggle: {borderWidth: 1, borderColor: 'black'},
    cameraSection: {margin: 20, flexDirection: 'row'},
    listViewContainer: {height: 150},
    room: {width: 200, height: 40, borderColor: 'gray', borderWidth: 0},
    textRoom: {width: 200, height: 30, borderColor: 'gray', borderWidth: 1},
    videoRoom: {alignItems: 'center', justifyContent: 'center', flexDirection: 'column'},
});

AppRegistry.registerComponent('RCTWebRTCDemo', () => RCTWebRTCDemo);
console.disableYellowBox = true;
