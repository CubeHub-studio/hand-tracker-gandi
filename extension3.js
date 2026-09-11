(function (Scratch) {
    "use strict";

    const Cast = Scratch.Cast;

    class PalmTracking {
        constructor() {
            this.video = null;
            this.stream = null;
            this.hands = null;
            this.running = false;
            this.processing = false;

            this.left = {
                detected: false,
                x: 0,
                y: 0,
                z: 0
            };

            this.right = {
                detected: false,
                x: 0,
                y: 0,
                z: 0
            };

            this._scriptLoaded = false;
            this._loading = false;

            this._loadPromise = null;

            this._lastProcess = 0;
            this._processInterval = 50; // ~20 FPS
        }

        async loadMediaPipe() {
            if (this._scriptLoaded) {
                return;
            }

            if (this._loadPromise) {
                return this._loadPromise;
            }

            this._loadPromise = new Promise((resolve, reject) => {
                const script = document.createElement("script");

                script.src =
                    "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";

                script.onload = () => {
                    this._scriptLoaded = true;
                    resolve();
                };

                script.onerror = () => {
                    this._loadPromise = null;
                    reject(new Error("Could not load MediaPipe Hands."));
                };

                document.head.appendChild(script);
            });

            return this._loadPromise;
        }

        async start() {
            if (this.running) {
                return;
            }

            if (this._loading) {
                return;
            }

            this._loading = true;

            try {
                await this.loadMediaPipe();

                this.video = document.createElement("video");

                this.video.autoplay = true;
                this.video.playsInline = true;
                this.video.muted = true;

                this.video.width = 320;
                this.video.height = 240;

                this.video.style.display = "none";

                document.body.appendChild(this.video);

                this.stream =
                    await navigator.mediaDevices.getUserMedia({
                        video: {
                            width: {
                                ideal: 320
                            },
                            height: {
                                ideal: 240
                            },
                            frameRate: {
                                ideal: 20,
                                max: 24
                            }
                        },
                        audio: false
                    });

                this.video.srcObject = this.stream;

                await new Promise(resolve => {
                    if (this.video.readyState >= 2) {
                        resolve();
                    } else {
                        this.video.onloadeddata = resolve;
                    }
                });

                this.hands = new window.Hands({
                    locateFile: file => {
                        return "https://cdn.jsdelivr.net/npm/@mediapipe/hands/" + file;
                    }
                });

                this.hands.setOptions({
                    maxNumHands: 2,
                    modelComplexity: 0,
                    minDetectionConfidence: 0.6,
                    minTrackingConfidence: 0.6
                });

                this.hands.onResults(results => {
                    this.processResults(results);
                });

                this.running = true;
                this.processing = false;
                this._lastProcess = 0;

                this.processFrame();

            } catch (error) {
                console.error("Palm Tracking:", error);
                this.stop();
            } finally {
                this._loading = false;
            }
        }

        async processFrame() {
            if (!this.running) {
                return;
            }

            const now = performance.now();

            if (
                now - this._lastProcess >= this._processInterval &&
                !this.processing &&
                this.video &&
                this.video.readyState >= 2
            ) {
                this._lastProcess = now;
                this.processing = true;

                try {
                    await this.hands.send({
                        image: this.video
                    });
                } catch (error) {
                    console.warn("MediaPipe frame error:", error);
                }

                this.processing = false;
            }

            requestAnimationFrame(() => this.processFrame());
        }

        processResults(results) {
            this.left.detected = false;
            this.right.detected = false;

            if (
                !results ||
                !results.multiHandLandmarks ||
                !results.multiHandedness
            ) {
                return;
            }

            const hands = results.multiHandLandmarks;
            const handedness = results.multiHandedness;

            for (let i = 0; i < hands.length && i < 2; i++) {
                const landmarks = hands[i];
                const classification = handedness[i];

                if (!landmarks || !classification) {
                    continue;
                }

                let side = classification.label;

                /*
                 * MediaPipe's handedness assumes the image is mirrored.
                 * Because the webcam is normally shown as a selfie view,
                 * swap the labels so they correspond to the user's
                 * physical left/right hands.
                 */
                side = side === "Left" ? "Right" : "Left";

                const palm = this.getPalmCenter(landmarks);

                const x = this.toGandiX(palm.x);
                const y = this.toGandiY(palm.y);

                /*
                 * MediaPipe Z:
                 *   negative = closer to camera
                 *   positive = farther away
                 *
                 * Convert this to:
                 *   0   = far
                 *   100 = close
                 */
                let closeness = 50 - palm.z * 500;

                closeness = Math.max(
                    0,
                    Math.min(100, closeness)
                );

                if (side === "Left") {
                    this.left.detected = true;

                    this.left.x = x;
                    this.left.y = y;

                    this.left.z +=
                        (closeness - this.left.z) * 0.15;
                } else {
                    this.right.detected = true;

                    this.right.x = x;
                    this.right.y = y;

                    this.right.z +=
                        (closeness - this.right.z) * 0.15;
                }
            }
        }

        getPalmCenter(landmarks) {
            /*
             * Palm points:
             * 0  = wrist
             * 5  = index MCP
             * 9  = middle MCP
             * 13 = ring MCP
             * 17 = pinky MCP
             */

            const ids = [0, 5, 9, 13, 17];

            let x = 0;
            let y = 0;
            let z = 0;

            for (const id of ids) {
                x += landmarks[id].x;
                y += landmarks[id].y;
                z += landmarks[id].z;
            }

            return {
                x: x / ids.length,
                y: y / ids.length,
                z: z / ids.length
            };
        }

        toGandiX(x) {
            return Math.max(
                -240,
                Math.min(
                    240,
                    x * 480 - 240
                )
            );
        }

        toGandiY(y) {
            return Math.max(
                -180,
                Math.min(
                    180,
                    180 - y * 360
                )
            );
        }

        getHand(hand) {
            if (hand === "Right") {
                return this.right;
            }

            return this.left;
        }

        stop() {
            this.running = false;
            this.processing = false;

            if (this.stream) {
                for (const track of this.stream.getTracks()) {
                    track.stop();
                }

                this.stream = null;
            }

            if (this.video) {
                this.video.srcObject = null;

                if (this.video.parentNode) {
                    this.video.parentNode.removeChild(this.video);
                }

                this.video = null;
            }

            this.hands = null;

            this.left.detected = false;
            this.right.detected = false;

            this.left.x = 0;
            this.left.y = 0;
            this.left.z = 0;

            this.right.x = 0;
            this.right.y = 0;
            this.right.z = 0;
        }
    }

    const tracker = new PalmTracking();

    class PalmExtension {
        getInfo() {
            return {
                id: "palmtracking",

                name: "Palm Tracking",

                color1: "#5B8DEF",
                color2: "#4A78D0",
                color3: "#3B65B5",

                blocks: [

                    {
                        opcode: "startTracking",
                        blockType: Scratch.BlockType.COMMAND,
                        text: "start palm tracking"
                    },

                    {
                        opcode: "stopTracking",
                        blockType: Scratch.BlockType.COMMAND,
                        text: "stop palm tracking"
                    },

                    {
                        opcode: "leftDetected",
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: "left palm detected?"
                    },

                    {
                        opcode: "rightDetected",
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: "right palm detected?"
                    },

                    {
                        opcode: "palmX",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm x [HAND]",
                        arguments: {
                            HAND: {
                                type: Scratch.ArgumentType.STRING,
                                menu: "hands",
                                defaultValue: "Left"
                            }
                        }
                    },

                    {
                        opcode: "palmY",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm y [HAND]",
                        arguments: {
                            HAND: {
                                type: Scratch.ArgumentType.STRING,
                                menu: "hands",
                                defaultValue: "Left"
                            }
                        }
                    },

                    {
                        opcode: "palmZ",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm z [HAND]",
                        arguments: {
                            HAND: {
                                type: Scratch.ArgumentType.STRING,
                                menu: "hands",
                                defaultValue: "Left"
                            }
                        }
                    }

                ],

                menus: {
                    hands: {
                        acceptReporters: false,

                        items: [
                            {
                                text: "Left",
                                value: "Left"
                            },
                            {
                                text: "Right",
                                value: "Right"
                            }
                        ]
                    }
                }
            };
        }

        async startTracking() {
            await tracker.start();
        }

        stopTracking() {
            tracker.stop();
        }

        leftDetected() {
            return tracker.left.detected;
        }

        rightDetected() {
            return tracker.right.detected;
        }

        palmX(args) {
            const hand = Cast.toString(args.HAND);
            const data = tracker.getHand(hand);

            return data.x;
        }

        palmY(args) {
            const hand = Cast.toString(args.HAND);
            const data = tracker.getHand(hand);

            return data.y;
        }

        palmZ(args) {
            const hand = Cast.toString(args.HAND);
            const data = tracker.getHand(hand);

            return data.z;
        }
    }

    Scratch.extensions.register(new PalmExtension());

})(Scratch);
