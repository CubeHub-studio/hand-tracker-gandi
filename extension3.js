(function (Scratch) {
    "use strict";

    if (!Scratch.extensions.unsandboxed) {
        throw new Error("Palm Tracking must run unsandboxed.");
    }

    class PalmTracking {
        constructor() {
            // Camera
            this.video = null;
            this.stream = null;

            // MediaPipe
            this.hands = null;
            this.mediaPipeLoading = false;
            this.mediaPipeLoaded = false;

            // State
            this.running = false;
            this.detected = false;
            this.processing = false;

            // Gandi coordinates
            this._palmX = 0;
            this._palmY = 0;
            this._palmZ = 0;

            // Processing control
            this.lastFrameTime = 0;
            this.frameInterval = 1000 / 24;

            // Low resolution = much less CPU/RAM pressure
            this.width = 320;
            this.height = 240;

            // Prevent excessive processing
            this.maxProcessingTime = 100;
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
                        opcode: "start",
                        blockType: Scratch.BlockType.COMMAND,
                        text: "start palm tracking"
                    },

                    {
                        opcode: "stop",
                        blockType: Scratch.BlockType.COMMAND,
                        text: "stop palm tracking"
                    },

                    {
                        opcode: "detected",
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: "palm detected?"
                    },

                    {
                        opcode: "getX",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm x"
                    },

                    {
                        opcode: "getY",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm y"
                    },

                    {
                        opcode: "getZ",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm z"
                    }
                ]
            };
        }

        loadScript(url) {
            return new Promise((resolve, reject) => {
                const script = document.createElement("script");

                script.src = url;

                script.onload = () => {
                    resolve();
                };

                script.onerror = () => {
                    reject(new Error(
                        "Failed to load MediaPipe: " + url
                    ));
                };

                document.head.appendChild(script);
            });
        }

        async loadMediaPipe() {
            if (this.mediaPipeLoaded) {
                return;
            }

            if (this.mediaPipeLoading) {
                while (this.mediaPipeLoading) {
                    await new Promise(resolve => {
                        setTimeout(resolve, 20);
                    });
                }

                return;
            }

            this.mediaPipeLoading = true;

            try {
                if (typeof Hands === "undefined") {
                    await this.loadScript(
                        "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"
                    );
                }

                this.hands = new Hands({
                    locateFile: function (file) {
                        return (
                            "https://cdn.jsdelivr.net/npm/" +
                            "@mediapipe/hands/" +
                            file
                        );
                    }
                });

                this.hands.setOptions({
                    maxNumHands: 1,

                    modelComplexity: 0,

                    minDetectionConfidence: 0.65,
                    minTrackingConfidence: 0.65
                });

                this.hands.onResults(
                    results => this.processResults(results)
                );

                this.mediaPipeLoaded = true;

            } catch (e) {
                console.error(
                    "Palm Tracking MediaPipe error:",
                    e
                );
            }

            this.mediaPipeLoading = false;
        }

        async start() {
            if (this.running) {
                return;
            }

            await this.loadMediaPipe();

            if (!this.mediaPipeLoaded) {
                return;
            }

            try {
                this.video = document.createElement("video");

                this.video.autoplay = true;
                this.video.muted = true;
                this.video.playsInline = true;

                this.video.width = this.width;
                this.video.height = this.height;

                this.video.style.display = "none";

                document.body.appendChild(this.video);

                this.stream =
                    await navigator.mediaDevices.getUserMedia({
                        video: {
                            width: {
                                ideal: this.width
                            },

                            height: {
                                ideal: this.height
                            },

                            frameRate: {
                                ideal: 24,
                                max: 24
                            }
                        },

                        audio: false
                    });

                this.video.srcObject = this.stream;

                await this.video.play();

                this.running = true;
                this.detected = false;

                this._palmX = 0;
                this._palmY = 0;
                this._palmZ = 0;

                this.lastFrameTime = performance.now();

                this.frameLoop();

            } catch (e) {
                console.error(
                    "Palm Tracking camera error:",
                    e
                );

                this.cleanupCamera();
            }
        }

        stop() {
            this.running = false;
            this.detected = false;
            this.processing = false;

            this.cleanupCamera();

            // Keep reporter values as numbers.
            this._palmX = 0;
            this._palmY = 0;
            this._palmZ = 0;
        }

        cleanupCamera() {
            if (this.stream) {
                const tracks = this.stream.getTracks();

                for (let i = 0; i < tracks.length; i++) {
                    try {
                        tracks[i].stop();
                    } catch (e) {}
                }

                this.stream = null;
            }

            if (this.video) {
                try {
                    this.video.pause();
                } catch (e) {}

                try {
                    this.video.srcObject = null;
                } catch (e) {}

                try {
                    this.video.remove();
                } catch (e) {}

                this.video = null;
            }
        }

        frameLoop() {
            if (!this.running) {
                return;
            }

            const now = performance.now();

            if (
                !this.processing &&
                this.video &&
                this.video.readyState >= 2 &&
                now - this.lastFrameTime >= this.frameInterval
            ) {
                this.lastFrameTime = now;

                this.processing = true;

                // IMPORTANT:
                // Do not await MediaPipe from the project thread.
                Promise.resolve(
                    this.hands.send({
                        image: this.video
                    })
                )
                .catch(error => {
                    console.error(
                        "MediaPipe frame error:",
                        error
                    );
                })
                .finally(() => {
                    this.processing = false;
                });
            }

            setTimeout(() => {
                this.frameLoop();
            }, 4);
        }

        processResults(results) {
            if (!this.running) {
                return;
            }

            if (
                !results ||
                !results.multiHandLandmarks ||
                results.multiHandLandmarks.length === 0
            ) {
                this.detected = false;
                return;
            }

            const hand =
                results.multiHandLandmarks[0];

            if (!hand || hand.length < 18) {
                this.detected = false;
                return;
            }

            /*
             * Palm center:
             *
             * 0  = wrist
             * 5  = index MCP
             * 9  = middle MCP
             * 13 = ring MCP
             * 17 = pinky MCP
             */

            const p0 = hand[0];
            const p5 = hand[5];
            const p9 = hand[9];
            const p13 = hand[13];
            const p17 = hand[17];

            const x =
                (
                    p0.x +
                    p5.x +
                    p9.x +
                    p13.x +
                    p17.x
                ) / 5;

            const y =
                (
                    p0.y +
                    p5.y +
                    p9.y +
                    p13.y +
                    p17.y
                ) / 5;

            const z =
                (
                    p0.z +
                    p5.z +
                    p9.z +
                    p13.z +
                    p17.z
                ) / 5;

            /*
             * MediaPipe X:
             *
             * 0 = left
             * 1 = right
             *
             * Gandi X:
             *
             * -240 = left
             *  240 = right
             */

            let gx = (x * 480) - 240;

            /*
             * MediaPipe Y:
             *
             * 0 = top
             * 1 = bottom
             *
             * Gandi Y:
             *
             * 180 = top
             * -180 = bottom
             */

            let gy = 180 - (y * 360);

            // Clamp values.

            if (gx < -240) gx = -240;
            if (gx > 240) gx = 240;

            if (gy < -180) gy = -180;
            if (gy > 180) gy = 180;

            /*
             * ONLY assign primitive numbers.
             *
             * The Gandi reporter blocks never perform
             * calculations or MediaPipe operations.
             */

            this._palmX = Number(gx);
            this._palmY = Number(gy);
            this._palmZ = Number(z);

            this.detected = true;
        }

        detected() {
            // Extremely cheap reporter.
            return this.detected === true;
        }

        getX() {
            // Extremely cheap reporter.
            return this._palmX;
        }

        getY() {
            // Extremely cheap reporter.
            return this._palmY;
        }

        getZ() {
            // Extremely cheap reporter.
            return this._palmZ;
        }
    }

    Scratch.extensions.register(
        new PalmTracking()
    );

})(Scratch);
