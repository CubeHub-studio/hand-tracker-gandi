(function (Scratch) {
    "use strict";

    if (!Scratch.extensions.unsandboxed) {
        throw new Error("Palm Tracking requires unsandboxed mode.");
    }

    class PalmTracking {
        constructor() {
            this.video = null;
            this.canvas = null;
            this.ctx = null;

            this.hands = null;
            this.camera = null;

            this.running = false;
            this.processing = false;

            this.palmX = 0;
            this.palmY = 0;
            this.palmZ = 0;

            this.detected = false;

            this.lastProcessTime = 0;

            this.width = 320;
            this.height = 240;

            this.fpsLimit = 30;
            this.frameInterval = 1000 / this.fpsLimit;
        }

        getInfo() {
            return {
                id: "palmtracking",
                name: "Palm Tracking",
                color1: "#5B8DEF",
                color2: "#4169C1",
                color3: "#3157A6",

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
                        opcode: "isTracking",
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: "palm detected?"
                    },

                    {
                        opcode: "palmX",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm x"
                    },

                    {
                        opcode: "palmY",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm y"
                    },

                    {
                        opcode: "palmZ",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm z"
                    }
                ]
            };
        }

        async loadMediaPipe() {
            if (this.hands) {
                return;
            }

            await this.loadScript(
                "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"
            );

            await this.loadScript(
                "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"
            );

            this.hands = new Hands({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
                }
            });

            this.hands.setOptions({
                maxNumHands: 1,

                modelComplexity: 1,

                minDetectionConfidence: 0.7,
                minTrackingConfidence: 0.7
            });

            this.hands.onResults((results) => {
                this.handleResults(results);
            });
        }

        loadScript(src) {
            return new Promise((resolve, reject) => {
                const existing = document.querySelector(
                    `script[src="${src}"]`
                );

                if (existing) {
                    resolve();
                    return;
                }

                const script = document.createElement("script");

                script.src = src;
                script.onload = resolve;
                script.onerror = reject;

                document.head.appendChild(script);
            });
        }

        async startTracking() {
            if (this.running) {
                return;
            }

            try {
                await this.loadMediaPipe();

                if (!this.video) {
                    this.video = document.createElement("video");

                    this.video.autoplay = true;
                    this.video.playsInline = true;
                    this.video.muted = true;

                    this.video.width = this.width;
                    this.video.height = this.height;

                    this.video.style.display = "none";

                    document.body.appendChild(this.video);
                }

                if (!this.canvas) {
                    this.canvas = document.createElement("canvas");

                    this.canvas.width = this.width;
                    this.canvas.height = this.height;

                    this.ctx = this.canvas.getContext("2d", {
                        willReadFrequently: true
                    });
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: {
                            ideal: this.width
                        },

                        height: {
                            ideal: this.height
                        },

                        frameRate: {
                            ideal: this.fpsLimit,
                            max: this.fpsLimit
                        }
                    },

                    audio: false
                });

                this.video.srcObject = stream;

                await this.video.play();

                this.running = true;

                this.processLoop();

            } catch (error) {
                console.error(
                    "Palm Tracking camera error:",
                    error
                );
            }
        }

        stopTracking() {
            this.running = false;

            this.detected = false;

            this.palmX = 0;
            this.palmY = 0;
            this.palmZ = 0;

            if (this.camera) {
                try {
                    this.camera.stop();
                } catch (e) {}
                this.camera = null;
            }

            if (this.video && this.video.srcObject) {
                const tracks =
                    this.video.srcObject.getTracks();

                for (const track of tracks) {
                    track.stop();
                }

                this.video.srcObject = null;
            }
        }

        async processLoop() {
            if (!this.running) {
                return;
            }

            const now = performance.now();

            if (
                !this.processing &&
                now - this.lastProcessTime >= this.frameInterval
            ) {
                this.processing = true;
                this.lastProcessTime = now;

                try {
                    if (
                        this.video &&
                        this.video.readyState >= 2
                    ) {
                        await this.hands.send({
                            image: this.video
                        });
                    }
                } catch (error) {
                    console.error(
                        "MediaPipe processing error:",
                        error
                    );
                }

                this.processing = false;
            }

            requestAnimationFrame(() => {
                this.processLoop();
            });
        }

        handleResults(results) {
            if (
                !results.multiHandLandmarks ||
                results.multiHandLandmarks.length === 0
            ) {
                this.detected = false;
                return;
            }

            const landmarks =
                results.multiHandLandmarks[0];

            /*
             * MediaPipe hand landmarks:
             *
             * 0  = wrist
             * 1  = thumb CMC
             * 2  = thumb MCP
             * 3  = thumb IP
             * 4  = thumb tip
             *
             * 5  = index MCP
             * 9  = middle MCP
             * 13 = ring MCP
             * 17 = pinky MCP
             *
             * We use the wrist and four MCP joints
             * to calculate the center of the palm.
             */

            const palmPoints = [
                landmarks[0],
                landmarks[5],
                landmarks[9],
                landmarks[13],
                landmarks[17]
            ];

            let x = 0;
            let y = 0;
            let z = 0;

            for (const point of palmPoints) {
                x += point.x;
                y += point.y;
                z += point.z;
            }

            x /= palmPoints.length;
            y /= palmPoints.length;
            z /= palmPoints.length;

            /*
             * MediaPipe:
             *
             * X:
             * 0 = left
             * 1 = right
             *
             * Y:
             * 0 = top
             * 1 = bottom
             *
             * Gandi:
             *
             * X:
             * -240 = left
             *  240 = right
             *
             * Y:
             * -180 = bottom
             *  180 = top
             */

            this.palmX = (x * 480) - 240;

            this.palmY = 180 - (y * 360);

            /*
             * MediaPipe Z is relative depth.
             *
             * Keep the raw-ish value available separately.
             */

            this.palmZ = z;

            /*
             * Keep the values inside the Gandi stage.
             */

            this.palmX = Math.max(
                -240,
                Math.min(240, this.palmX)
            );

            this.palmY = Math.max(
                -180,
                Math.min(180, this.palmY)
            );

            this.detected = true;
        }

        isTracking() {
            return this.detected;
        }

        palmX() {
            return this.palmX;
        }

        palmY() {
            return this.palmY;
        }

        palmZ() {
            return this.palmZ;
        }
    }

    Scratch.extensions.register(
        new PalmTracking()
    );

})(Scratch);
