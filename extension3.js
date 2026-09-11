(function (Scratch) {
    "use strict";

    if (!Scratch.extensions.unsandboxed) {
        throw new Error(
            "Palm Tracking requires an unsandboxed extension."
        );
    }

    class PalmTracking {
        constructor() {
            // ==========================================
            // CAMERA
            // ==========================================

            this.video = null;
            this.stream = null;

            this.cameraWidth = 320;
            this.cameraHeight = 240;

            // ==========================================
            // MEDIAPIPE
            // ==========================================

            this.hands = null;
            this.loadingMediaPipe = false;
            this.mediaPipeReady = false;

            // ==========================================
            // TRACKING STATE
            // ==========================================

            this.running = false;
            this.processing = false;

            // IMPORTANT:
            // Do NOT call this "detected".
            // The reporter is also named detected().
            this._handDetected = false;

            // ==========================================
            // OUTPUT VALUES
            // ==========================================

            this._palmX = 0;
            this._palmY = 0;
            this._palmZ = 0;

            // ==========================================
            // Z SMOOTHING
            // ==========================================

            this._zInitialized = false;
            this._smoothZ = 0;

            // 0.15 = smooth and responsive
            this.zSmoothing = 0.15;

            // ==========================================
            // FRAME LIMIT
            // ==========================================

            this.fps = 20;
            this.frameInterval = 1000 / this.fps;

            this.lastFrameTime = 0;

            // Prevent multiple frame loops.
            this.loopActive = false;
        }

        // ==========================================
        // BLOCK INFORMATION
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
                        opcode: "handDetected",
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

        // ==========================================
        // LOAD EXTERNAL SCRIPT
        // ==========================================

        loadScript(url) {
            return new Promise((resolve, reject) => {
                // Don't load the same script twice.

                const scripts =
                    document.getElementsByTagName("script");

                for (let i = 0; i < scripts.length; i++) {
                    if (scripts[i].src === url) {
                        resolve();
                        return;
                    }
                }

                const script =
                    document.createElement("script");

                script.src = url;

                script.onload = function () {
                    resolve();
                };

                script.onerror = function () {
                    reject(
                        new Error(
                            "Could not load " + url
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
            if (this.mediaPipeReady) {
                return true;
            }

            if (this.loadingMediaPipe) {
                while (this.loadingMediaPipe) {
                    await new Promise(resolve => {
                        setTimeout(resolve, 25);
                    });
                }

                return this.mediaPipeReady;
            }

            this.loadingMediaPipe = true;

            try {
                if (
                    typeof window.Hands === "undefined" &&
                    typeof Hands === "undefined"
                ) {
                    await this.loadScript(
                        "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"
                    );
                }

                const HandsClass =
                    typeof window.Hands !== "undefined"
                        ? window.Hands
                        : Hands;

                this.hands = new HandsClass({
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

                    // Lightweight model.
                    modelComplexity: 0,

                    minDetectionConfidence: 0.7,
                    minTrackingConfidence: 0.7
                });

                this.hands.onResults(
                    results => {
                        this.onResults(results);
                    }
                );

                this.mediaPipeReady = true;

            } catch (error) {
                console.error(
                    "[Palm Tracking] MediaPipe initialization failed:",
                    error
                );

                this.mediaPipeReady = false;

            } finally {
                this.loadingMediaPipe = false;
            }

            return this.mediaPipeReady;
        }

        // ==========================================
        // START
        // ==========================================

        async startTracking() {
            // Already running.
            if (this.running) {
                return;
            }

            const loaded =
                await this.loadMediaPipe();

            if (!loaded) {
                console.error(
                    "[Palm Tracking] MediaPipe is not ready."
                );

                return;
            }

            try {
                // --------------------------------------
                // CREATE VIDEO
                // --------------------------------------

                this.video =
                    document.createElement("video");

                this.video.autoplay = true;
                this.video.muted = true;
                this.video.playsInline = true;

                this.video.width =
                    this.cameraWidth;

                this.video.height =
                    this.cameraHeight;

                // Don't display the camera.
                this.video.style.display = "none";

                document.body.appendChild(this.video);

                // --------------------------------------
                // CAMERA
                // --------------------------------------

                this.stream =
                    await navigator.mediaDevices
                        .getUserMedia({
                            video: {
                                width: {
                                    ideal:
                                        this.cameraWidth
                                },

                                height: {
                                    ideal:
                                        this.cameraHeight
                                },

                                frameRate: {
                                    ideal: this.fps,
                                    max: this.fps
                                }
                            },

                            audio: false
                        });

                // --------------------------------------
                // CONNECT VIDEO
                // --------------------------------------

                this.video.srcObject =
                    this.stream;

                await this.video.play();

                // --------------------------------------
                // RESET STATE
                // --------------------------------------

                this._handDetected = false;

                this._palmX = 0;
                this._palmY = 0;
                this._palmZ = 0;

                this._zInitialized = false;
                this._smoothZ = 0;

                this.processing = false;

                this.running = true;

                this.lastFrameTime =
                    performance.now();

                // --------------------------------------
                // START ONLY ONE LOOP
                // --------------------------------------

                if (!this.loopActive) {
                    this.loopActive = true;
                    this.frameLoop();
                }

            } catch (error) {
                console.error(
                    "[Palm Tracking] Camera error:",
                    error
                );

                this.stopTracking();
            }
        }

        // ==========================================
        // STOP
        // ==========================================

        stopTracking() {
            this.running = false;

            this._handDetected = false;

            this.processing = false;

            // --------------------------------------
            // STOP CAMERA
            // --------------------------------------

            if (this.stream) {
                const tracks =
                    this.stream.getTracks();

                for (let i = 0; i < tracks.length; i++) {
                    try {
                        tracks[i].stop();
                    } catch (e) {
                        // Ignore camera cleanup errors.
                    }
                }

                this.stream = null;
            }

            // --------------------------------------
            // REMOVE VIDEO
            // --------------------------------------

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

            // --------------------------------------
            // RESET VALUES
            // --------------------------------------

            this._palmX = 0;
            this._palmY = 0;
            this._palmZ = 0;

            this._zInitialized = false;
            this._smoothZ = 0;
        }

        // ==========================================
        // FRAME LOOP
        // ==========================================

        frameLoop() {
            // The loop itself stays alive but does
            // absolutely nothing when tracking stops.

            if (!this.loopActive) {
                return;
            }

            const now =
                performance.now();

            if (
                this.running &&
                !this.processing &&
                this.video &&
                this.video.readyState >= 2 &&
                (
                    now - this.lastFrameTime >=
                    this.frameInterval
                )
            ) {
                this.lastFrameTime = now;

                this.processing = true;

                /*
                 * IMPORTANT:
                 *
                 * MediaPipe processing is NOT awaited.
                 * The Gandi VM is never blocked waiting
                 * for a camera frame.
                 */

                let promise;

                try {
                    promise =
                        this.hands.send({
                            image: this.video
                        });
                } catch (error) {
                    this.processing = false;

                    console.error(
                        "[Palm Tracking] MediaPipe send error:",
                        error
                    );

                    promise = null;
                }

                if (
                    promise &&
                    typeof promise.then === "function"
                ) {
                    promise.then(
                        () => {
                            this.processing = false;
                        },
                        error => {
                            this.processing = false;

                            console.error(
                                "[Palm Tracking] MediaPipe error:",
                                error
                            );
                        }
                    );
                } else {
                    this.processing = false;
                }
            }

            // Don't use requestAnimationFrame for
            // every MediaPipe cycle.
            //
            // This gives the browser breathing room.
            setTimeout(() => {
                this.frameLoop();
            }, 10);
        }

        // ==========================================
        // MEDIAPIPE RESULTS
        // ==========================================

        onResults(results) {
            if (!this.running) {
                return;
            }

            /*
             * No hand.
             */

            if (
                !results ||
                !results.multiHandLandmarks ||
                results.multiHandLandmarks.length === 0
            ) {
                this._handDetected = false;
                return;
            }

            const hand =
                results.multiHandLandmarks[0];

            if (
                !hand ||
                hand.length < 18
            ) {
                this._handDetected = false;
                return;
            }

            // ======================================
            // LANDMARKS
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
            // X → GANDI
            // ======================================

            let gx =
                (x * 480) - 240;

            // ======================================
            // Y → GANDI
            // ======================================

            let gy =
                180 - (y * 360);

            // ======================================
            // SAFETY CHECK X
            // ======================================

            if (!Number.isFinite(gx)) {
                gx = 0;
            }

            if (gx < -240) {
                gx = -240;
            }

            if (gx > 240) {
                gx = 240;
            }

            // ======================================
            // SAFETY CHECK Y
            // ======================================

            if (!Number.isFinite(gy)) {
                gy = 0;
            }

            if (gy < -180) {
                gy = -180;
            }

            if (gy > 180) {
                gy = 180;
            }

            // ======================================
            // Z → CLOSENESS
            // ======================================

            /*
             * MediaPipe hand Z:
             *
             * More negative = closer
             * More positive = farther
             *
             * Convert to:
             *
             * 0   = far
             * 100 = close
             */

            let closeness =
                50 - (z * 500);

            if (!Number.isFinite(closeness)) {
                closeness = 0;
            }

            // Clamp.

            if (closeness < 0) {
                closeness = 0;
            }

            if (closeness > 100) {
                closeness = 100;
            }

            // ======================================
            // SMOOTH Z
            // ======================================

            if (!this._zInitialized) {
                this._smoothZ =
                    closeness;

                this._zInitialized = true;

            } else {
                this._smoothZ +=
                    (
                        closeness -
                        this._smoothZ
                    ) *
                    this.zSmoothing;
            }

            // ======================================
            // FINAL Z
            // ======================================

            let finalZ =
                Math.round(
                    this._smoothZ * 10
                ) / 10;

            if (!Number.isFinite(finalZ)) {
                finalZ = 0;
            }

            if (finalZ < 0) {
                finalZ = 0;
            }

            if (finalZ > 100) {
                finalZ = 100;
            }

            // ======================================
            // UPDATE ONLY PRIMITIVE VALUES
            // ======================================

            this._palmX = gx;
            this._palmY = gy;
            this._palmZ = finalZ;

            this._handDetected = true;
        }

        // ==========================================
        // REPORTER: PALM DETECTED
        // ==========================================

        handDetected() {
            return this._handDetected;
        }

        // ==========================================
        // REPORTER: PALM X
        // ==========================================

        palmX() {
            return this._palmX;
        }

        // ==========================================
        // REPORTER: PALM Y
        // ==========================================

        palmY() {
            return this._palmY;
        }

        // ==========================================
        // REPORTER: PALM Z
        // ==========================================

        palmZ() {
            return this._palmZ;
        }
    }

    // ==============================================
    // REGISTER
    // ==============================================

    Scratch.extensions.register(
        new PalmTracking()
    );

})(Scratch);
