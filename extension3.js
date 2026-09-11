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
            this.mediaPipeReady = false;
            this.loadingMediaPipe = false;

            // ==========================================
            // TRACKING
            // ==========================================

            this.running = false;
            this.processing = false;
            this.loopActive = false;

            // ==========================================
            // LEFT HAND
            // ==========================================

            this.leftDetected = false;

            this.leftX = 0;
            this.leftY = 0;
            this.leftZ = 0;

            // ==========================================
            // RIGHT HAND
            // ==========================================

            this.rightDetected = false;

            this.rightX = 0;
            this.rightY = 0;
            this.rightZ = 0;

            // ==========================================
            // Z SMOOTHING
            // ==========================================

            this.leftZInitialized = false;
            this.rightZInitialized = false;

            this.leftSmoothZ = 0;
            this.rightSmoothZ = 0;

            this.zSmoothing = 0.15;

            // ==========================================
            // FRAME RATE
            // ==========================================

            this.fps = 20;
            this.frameInterval = 1000 / this.fps;

            this.lastFrameTime = 0;
        }

        // ==========================================
        // BLOCK INFO
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
                        text: "palm x of [HAND]"
                    },

                    {
                        opcode: "palmY",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm y of [HAND]"
                    },

                    {
                        opcode: "palmZ",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "palm z of [HAND]"
                    }
                ],

                menus: {
                    HAND: {
                        acceptReporters: false,
                        items: [
                            "Left",
                            "Right"
                        ]
                    }
                }
            };
        }

        // ==========================================
        // LOAD SCRIPT
        // ==========================================

        loadScript(url) {
            return new Promise((resolve, reject) => {
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
                    // TWO HANDS
                    maxNumHands: 2,

                    // Lightweight model
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
            if (this.running) {
                return;
            }

            const loaded =
                await this.loadMediaPipe();

            if (!loaded) {
                return;
            }

            try {
                this.video =
                    document.createElement("video");

                this.video.autoplay = true;
                this.video.muted = true;
                this.video.playsInline = true;

                this.video.width =
                    this.cameraWidth;

                this.video.height =
                    this.cameraHeight;

                this.video.style.display = "none";

                document.body.appendChild(
                    this.video
                );

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

                this.video.srcObject =
                    this.stream;

                await this.video.play();

                // Reset hands

                this.leftDetected = false;
                this.rightDetected = false;

                this.leftX = 0;
                this.leftY = 0;
                this.leftZ = 0;

                this.rightX = 0;
                this.rightY = 0;
                this.rightZ = 0;

                this.leftZInitialized = false;
                this.rightZInitialized = false;

                this.leftSmoothZ = 0;
                this.rightSmoothZ = 0;

                this.processing = false;
                this.running = true;

                this.lastFrameTime =
                    performance.now();

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
            this.processing = false;

            this.leftDetected = false;
            this.rightDetected = false;

            // Stop camera

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

            // Remove video

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

            // Reset values

            this.leftX = 0;
            this.leftY = 0;
            this.leftZ = 0;

            this.rightX = 0;
            this.rightY = 0;
            this.rightZ = 0;

            this.leftZInitialized = false;
            this.rightZInitialized = false;

            this.leftSmoothZ = 0;
            this.rightSmoothZ = 0;
        }

        // ==========================================
        // FRAME LOOP
        // ==========================================

        frameLoop() {
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
                now - this.lastFrameTime >=
                    this.frameInterval
            ) {
                this.lastFrameTime = now;

                this.processing = true;

                let promise = null;

                try {
                    promise =
                        this.hands.send({
                            image: this.video
                        });
                } catch (error) {
                    this.processing = false;

                    console.error(
                        "[Palm Tracking] MediaPipe error:",
                        error
                    );
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
                                "[Palm Tracking] Frame error:",
                                error
                            );
                        }
                    );
                } else if (promise !== null) {
                    this.processing = false;
                }
            }

            setTimeout(() => {
                this.frameLoop();
            }, 10);
        }

        // ==========================================
        // PROCESS RESULTS
        // ==========================================

        onResults(results) {
            if (!this.running) {
                return;
            }

            // Reset detection every frame.

            this.leftDetected = false;
            this.rightDetected = false;

            if (
                !results ||
                !results.multiHandLandmarks ||
                results.multiHandLandmarks.length === 0
            ) {
                return;
            }

            const landmarks =
                results.multiHandLandmarks;

            const handedness =
                results.multiHandedness || [];

            // ======================================
            // PROCESS BOTH HANDS
            // ======================================

            for (
                let i = 0;
                i < landmarks.length && i < 2;
                i++
            ) {
                const hand = landmarks[i];

                if (!hand || hand.length < 18) {
                    continue;
                }

                // MediaPipe handedness.

                let label = "";

                if (
                    handedness[i] &&
                    handedness[i].classification &&
                    handedness[i].classification[0]
                ) {
                    label =
                        handedness[i]
                            .classification[0]
                            .label;
                }

                // ==================================
                // PALM CENTER
                // ==================================

                const wrist = hand[0];
                const indexMCP = hand[5];
                const middleMCP = hand[9];
                const ringMCP = hand[13];
                const pinkyMCP = hand[17];

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

                // ==================================
                // GANDI X
                // ==================================

                let gx =
                    (x * 480) - 240;

                // ==================================
                // GANDI Y
                // ==================================

                let gy =
                    180 - (y * 360);

                // ==================================
                // SAFETY
                // ==================================

                if (!Number.isFinite(gx)) {
                    gx = 0;
                }

                if (!Number.isFinite(gy)) {
                    gy = 0;
                }

                if (gx < -240) gx = -240;
                if (gx > 240) gx = 240;

                if (gy < -180) gy = -180;
                if (gy > 180) gy = 180;

                // ==================================
                // CLOSENESS
                // ==================================

                let closeness =
                    50 - (z * 500);

                if (!Number.isFinite(closeness)) {
                    closeness = 0;
                }

                if (closeness < 0) {
                    closeness = 0;
                }

                if (closeness > 100) {
                    closeness = 100;
                }

                // ==================================
                // LEFT HAND
                // ==================================

                if (label === "Left") {
                    this.leftDetected = true;

                    this.leftX = gx;
                    this.leftY = gy;

                    if (!this.leftZInitialized) {
                        this.leftSmoothZ =
                            closeness;

                        this.leftZInitialized = true;

                    } else {
                        this.leftSmoothZ +=
                            (
                                closeness -
                                this.leftSmoothZ
                            ) *
                            this.zSmoothing;
                    }

                    this.leftZ =
                        Math.round(
                            this.leftSmoothZ * 10
                        ) / 10;
                }

                // ==================================
                // RIGHT HAND
                // ==================================

                else if (label === "Right") {
                    this.rightDetected = true;

                    this.rightX = gx;
                    this.rightY = gy;

                    if (!this.rightZInitialized) {
                        this.rightSmoothZ =
                            closeness;

                        this.rightZInitialized = true;

                    } else {
                        this.rightSmoothZ +=
                            (
                                closeness -
                                this.rightSmoothZ
                            ) *
                            this.zSmoothing;
                    }

                    this.rightZ =
                        Math.round(
                            this.rightSmoothZ * 10
                        ) / 10;
                }
            }

            // ======================================
            // RESET MISSING HAND VALUES
            // ======================================

            if (!this.leftDetected) {
                this.leftX = 0;
                this.leftY = 0;
                this.leftZ = 0;

                this.leftZInitialized = false;
            }

            if (!this.rightDetected) {
                this.rightX = 0;
                this.rightY = 0;
                this.rightZ = 0;

                this.rightZInitialized = false;
            }
        }

        // ==========================================
        // DETECTION REPORTERS
        // ==========================================

        leftDetected() {
            return this.leftDetected === true;
        }

        rightDetected() {
            return this.rightDetected === true;
        }

        // ==========================================
        // X REPORTER
        // ==========================================

        palmX(args) {
            if (args.HAND === "Left") {
                return this.leftX;
            }

            if (args.HAND === "Right") {
                return this.rightX;
            }

            return 0;
        }

        // ==========================================
        // Y REPORTER
        // ==========================================

        palmY(args) {
            if (args.HAND === "Left") {
                return this.leftY;
            }

            if (args.HAND === "Right") {
                return this.rightY;
            }

            return 0;
        }

        // ==========================================
        // Z REPORTER
        // ==========================================

        palmZ(args) {
            if (args.HAND === "Left") {
                return this.leftZ;
            }

            if (args.HAND === "Right") {
                return this.rightZ;
            }

            return 0;
        }
    }

    // ==============================================
    // REGISTER
    // ==============================================

    Scratch.extensions.register(
        new PalmTracking()
    );

})(Scratch);
