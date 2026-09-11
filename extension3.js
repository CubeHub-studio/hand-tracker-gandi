(function (Scratch) {
    "use strict";

    if (!Scratch.extensions.unsandboxed) {
        throw new Error("Palm Tracking must run unsandboxed.");
    }

    class PalmTracking {
        constructor() {
            // ==============================
            // CAMERA
            // ==============================

            this.video = null;
            this.stream = null;

            this.width = 320;
            this.height = 240;

            // ==============================
            // MEDIAPIPE
            // ==============================

            this.hands = null;
            this.mediaPipeLoaded = false;
            this.mediaPipeLoading = false;

            // ==============================
            // TRACKING STATE
            // ==============================

            this.running = false;
            this.processing = false;
            this.detected = false;

            // ==============================
            // GANDI COORDINATES
            // ==============================

            this._palmX = 0;
            this._palmY = 0;

            // Palm closeness:
            //
            // 0   = far
            // 100 = close
            //
            this._palmZ = 0;

            // ==============================
            // Z SMOOTHING
            // ==============================

            this.zInitialized = false;

            this.smoothedZ = 0;

            // Lower = smoother but slower.
            // Higher = faster but more jitter.
            this.zSmoothing = 0.15;

            // ==============================
            // FRAME RATE
            // ==============================

            this.fps = 24;
            this.frameInterval = 1000 / this.fps;

            this.lastFrameTime = 0;
        }

        // ==========================================
        // GANDI BLOCKS
        // ==========================================

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

        // ==========================================
        // LOAD JAVASCRIPT
        // ==========================================

        loadScript(url) {
            return new Promise((resolve, reject) => {
                const script = document.createElement("script");

                script.src = url;

                script.onload = () => {
                    resolve();
                };

                script.onerror = () => {
                    reject(
                        new Error(
                            "Failed to load MediaPipe: " + url
                        )
                    );
                };

                document.head.appendChild(script);
            });
        }

        // ==========================================
        // LOAD MEDIAPIPE
        // ==========================================

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

                    // Lower processing load.
                    modelComplexity: 0,

                    minDetectionConfidence: 0.65,
                    minTrackingConfidence: 0.65
                });

                this.hands.onResults(
                    results => {
                        this.processResults(results);
                    }
                );

                this.mediaPipeLoaded = true;

            } catch (error) {
                console.error(
                    "Palm Tracking MediaPipe error:",
                    error
                );
            }

            this.mediaPipeLoading = false;
        }

        // ==========================================
        // START TRACKING
        // ==========================================

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
                                ideal: this.fps,
                                max: this.fps
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

                // Reset Z smoothing.
                this.zInitialized = false;
                this.smoothedZ = 0;

                this.lastFrameTime = performance.now();

                this.frameLoop();

            } catch (error) {
                console.error(
                    "Palm Tracking camera error:",
                    error
                );

                this.cleanupCamera();
            }
        }

        // ==========================================
        // STOP TRACKING
        // ==========================================

        stop() {
            this.running = false;
            this.processing = false;
            this.detected = false;

            this.cleanupCamera();

            this._palmX = 0;
            this._palmY = 0;
            this._palmZ = 0;

            this.zInitialized = false;
            this.smoothedZ = 0;
        }

        // ==========================================
        // CLEAN UP CAMERA
        // ==========================================

        cleanupCamera() {
            if (this.stream) {
                const tracks =
                    this.stream.getTracks();

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

        // ==========================================
        // FRAME LOOP
        // ==========================================

        frameLoop() {
            if (!this.running) {
                return;
            }

            const now = performance.now();

            if (
                !this.processing &&
                this.video &&
                this.video.readyState >= 2 &&
                now - this.lastFrameTime >=
                    this.frameInterval
            ) {
                this.lastFrameTime = now;

                this.processing = true;

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

        // ==========================================
        // PROCESS MEDIAPIPE RESULTS
        // ==========================================

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

            // ======================================
            // PALM LANDMARKS
            // ======================================

            const wrist = hand[0];
            const indexMCP = hand[5];
            const middleMCP = hand[9];
            const ringMCP = hand[13];
            const pinkyMCP = hand[17];

            // ======================================
            // PALM CENTER
            // ======================================

            const x =
                (
                    wrist.x +
                    indexMCP.x +
                    middleMCP.x +
                    ringMCP.x +
                    pinkyMCP.x
                ) / 5;

            const y =
                (
                    wrist.y +
                    indexMCP.y +
                    middleMCP.y +
                    ringMCP.y +
                    pinkyMCP.y
                ) / 5;

            const z =
                (
                    wrist.z +
                    indexMCP.z +
                    middleMCP.z +
                    ringMCP.z +
                    pinkyMCP.z
                ) / 5;

            // ======================================
            // GANDI X
            // ======================================

            let gandiX =
                (x * 480) - 240;

            // ======================================
            // GANDI Y
            // ======================================

            let gandiY =
                180 - (y * 360);

            // Clamp X.

            if (gandiX < -240) {
                gandiX = -240;
            }

            if (gandiX > 240) {
                gandiX = 240;
            }

            // Clamp Y.

            if (gandiY < -180) {
                gandiY = -180;
            }

            if (gandiY > 180) {
                gandiY = 180;
            }

            // ======================================
            // PALM CLOSENESS
            // ======================================

            /*
             * MediaPipe Z is normally:
             *
             *   more negative = closer
             *   more positive = farther
             *
             * It is relative depth rather than
             * real-world centimeters.
             *
             * Typical hand Z values are roughly
             * around -0.1 to +0.1, although the
             * exact range varies.
             *
             * Convert that into a closeness value.
             */

            let closeness =
                50 - (z * 500);

            // ======================================
            // CLAMP TO 0-100
            // ======================================

            if (closeness < 0) {
                closeness = 0;
            }

            if (closeness > 100) {
                closeness = 100;
            }

            // ======================================
            // SMOOTH Z
            // ======================================

            if (!this.zInitialized) {
                this.smoothedZ = closeness;
                this.zInitialized = true;
            } else {
                this.smoothedZ =
                    this.smoothedZ +
                    (
                        closeness -
                        this.smoothedZ
                    ) *
                    this.zSmoothing;
            }

            // ======================================
            // ROUND Z
            // ======================================

            const finalZ =
                Math.round(
                    this.smoothedZ * 10
                ) / 10;

            // ======================================
            // UPDATE STATE
            // ======================================

            /*
             * These are ONLY primitive numbers.
             *
             * Gandi reporters simply return them.
             */

            this._palmX = Number(gandiX);
            this._palmY = Number(gandiY);
            this._palmZ = Number(finalZ);

            this.detected = true;
        }

        // ==========================================
        // REPORTERS
        // ==========================================

        detected() {
            return this.detected === true;
        }

        getX() {
            return this._palmX;
        }

        getY() {
            return this._palmY;
        }

        getZ() {
            return this._palmZ;
        }
    }

    // ==============================================
    // REGISTER EXTENSION
    // ==============================================

    Scratch.extensions.register(
        new PalmTracking()
    );

})(Scratch);
