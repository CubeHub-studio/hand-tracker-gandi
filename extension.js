class HandTrackingExtension {
    constructor() {
        this.video = document.createElement("video");

        this.video.autoplay = true;
        this.video.playsInline = true;
        this.video.muted = true;

        this.video.style.position = "fixed";
        this.video.style.left = "-10000px";
        this.video.style.top = "-10000px";
        this.video.style.width = "1px";
        this.video.style.height = "1px";
        this.video.style.opacity = "0";
        this.video.style.pointerEvents = "none";

        document.body.appendChild(this.video);

        this.stream = null;
        this.hands = null;

        this.running = false;
        this.loading = false;
        this.mediaPipeLoaded = false;

        this.results = null;

        // Prevent MediaPipe frame buildup
        this.processing = false;

        // Process at roughly 15 FPS instead of 60+ FPS
        this.lastProcessTime = 0;
        this.processInterval = 66;

        this.animationFrame = null;
    }

    // =========================================================
    // LOAD SCRIPT
    // =========================================================

    loadScript(url) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(
                'script[data-hand-tracking-mediapipe="true"]'
            );

            if (existing) {
                if (window.Hands) {
                    resolve();
                    return;
                }

                existing.addEventListener("load", resolve, {
                    once: true
                });

                existing.addEventListener("error", reject, {
                    once: true
                });

                return;
            }

            const script = document.createElement("script");

            script.src = url;
            script.async = true;
            script.crossOrigin = "anonymous";

            script.dataset.handTrackingMediapipe = "true";

            script.onload = () => {
                resolve();
            };

            script.onerror = () => {
                reject(
                    new Error(
                        "Could not load MediaPipe Hands."
                    )
                );
            };

            document.head.appendChild(script);
        });
    }

    // =========================================================
    // MEDIAPIPE
    // =========================================================

    async loadMediaPipe() {
        if (this.mediaPipeLoaded && this.hands) {
            return;
        }

        if (this.loading) {
            while (this.loading) {
                await new Promise(resolve =>
                    setTimeout(resolve, 50)
                );
            }

            if (this.mediaPipeLoaded && this.hands) {
                return;
            }
        }

        this.loading = true;

        try {
            await this.loadScript(
                "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js"
            );

            if (!window.Hands) {
                throw new Error(
                    "MediaPipe Hands did not create window.Hands."
                );
            }

            this.hands = new window.Hands({
                locateFile: file => {
                    return (
                        "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/" +
                        file
                    );
                }
            });

            this.hands.setOptions({
                maxNumHands: 2,

                modelComplexity: 0,

                minDetectionConfidence: 0.55,

                minTrackingConfidence: 0.55
            });

            this.hands.onResults(results => {
                // Replace the old result instead of accumulating results
                this.results = results;

                // MediaPipe is ready for another frame
                this.processing = false;
            });

            this.mediaPipeLoaded = true;

        } catch (error) {
            console.error(
                "MediaPipe initialization failed:",
                error
            );

            this.hands = null;
            this.mediaPipeLoaded = false;

            throw error;

        } finally {
            this.loading = false;
        }
    }

    // =========================================================
    // START
    // =========================================================

    async startHandTracking() {
        if (this.running) {
            return;
        }

        try {
            if (
                !navigator.mediaDevices ||
                !navigator.mediaDevices.getUserMedia
            ) {
                throw new Error(
                    "Camera access is not supported by this browser."
                );
            }

            // -------------------------------------------------
            // CAMERA
            // -------------------------------------------------

            this.stream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: {
                            ideal: 320,
                            max: 320
                        },

                        height: {
                            ideal: 240,
                            max: 240
                        },

                        frameRate: {
                            ideal: 15,
                            max: 20
                        },

                        facingMode: "user"
                    },

                    audio: false
                });

            this.video.srcObject = this.stream;

            await this.video.play();

            // -------------------------------------------------
            // MEDIAPIPE
            // -------------------------------------------------

            await this.loadMediaPipe();

            this.running = true;

            this.processing = false;
            this.lastProcessTime = 0;

            this.processLoop();

        } catch (error) {
            console.error(
                "Could not start hand tracking:",
                error
            );

            this.stopHandTracking();

            throw error;
        }
    }

    // =========================================================
    // STOP
    // =========================================================

    stopHandTracking() {
        this.running = false;

        this.processing = false;

        if (this.animationFrame !== null) {
            cancelAnimationFrame(
                this.animationFrame
            );

            this.animationFrame = null;
        }

        if (this.stream) {
            const tracks =
                this.stream.getTracks();

            for (const track of tracks) {
                track.stop();
            }
        }

        this.stream = null;

        this.video.pause();
        this.video.srcObject = null;

        this.results = null;

        this.lastProcessTime = 0;
    }

    // =========================================================
    // FRAME LOOP
    // =========================================================

    processLoop() {
        if (!this.running) {
            return;
        }

        const now = performance.now();

        /*
         * Don't process more than ~15 frames per second.
         */
        if (
            now - this.lastProcessTime >=
            this.processInterval
        ) {
            this.lastProcessTime = now;

            this.processCurrentFrame();
        }

        this.animationFrame =
            requestAnimationFrame(
                () => this.processLoop()
            );
    }

    // =========================================================
    // PROCESS ONE FRAME
    // =========================================================

    async processCurrentFrame() {
        /*
         * CRITICAL:
         *
         * Never call MediaPipe again while the previous
         * frame is still being processed.
         */
        if (this.processing) {
            return;
        }

        if (!this.hands) {
            return;
        }

        if (!this.running) {
            return;
        }

        if (this.video.readyState < 2) {
            return;
        }

        if (
            this.video.videoWidth <= 0 ||
            this.video.videoHeight <= 0
        ) {
            return;
        }

        this.processing = true;

        try {
            await this.hands.send({
                image: this.video
            });

        } catch (error) {
            console.error(
                "MediaPipe processing error:",
                error
            );

            /*
             * IMPORTANT:
             * Make sure an error doesn't permanently
             * lock the processing state.
             */
            this.processing = false;
        }
    }

    // =========================================================
    // CAMERA STATUS
    // =========================================================

    cameraActive() {
        return this.running;
    }

    // =========================================================
    // NUMBER OF HANDS
    // =========================================================

    getNumberOfHands() {
        if (!this.results) {
            return 0;
        }

        if (!this.results.multiHandLandmarks) {
            return 0;
        }

        return this.results.multiHandLandmarks.length;
    }

    // =========================================================
    // FIND LEFT / RIGHT HAND
    // =========================================================

    getHandIndex(hand) {
        if (!this.results) {
            return -1;
        }

        if (!this.results.multiHandedness) {
            return -1;
        }

        const wanted =
            String(hand || "").toLowerCase();

        for (
            let i = 0;
            i < this.results.multiHandedness.length;
            i++
        ) {
            const handedness =
                this.results.multiHandedness[i];

            if (!handedness) {
                continue;
            }

            let label = "";

            if (handedness.label) {
                label =
                    String(
                        handedness.label
                    ).toLowerCase();
            }

            if (
                handedness.classification &&
                handedness.classification.length > 0
            ) {
                label =
                    String(
                        handedness
                            .classification[0]
                            .label
                    ).toLowerCase();
            }

            if (label === wanted) {
                return i;
            }
        }

        return -1;
    }

    // =========================================================
    // HAND DETECTED
    // =========================================================

    handDetected(args) {
        return (
            this.getHandIndex(
                args.HAND
            ) !== -1
        );
    }

    // =========================================================
    // GET LANDMARK
    // =========================================================

    getLandmark(hand, index) {
        if (!this.results) {
            return null;
        }

        if (!this.results.multiHandLandmarks) {
            return null;
        }

        const handIndex =
            this.getHandIndex(hand);

        if (handIndex === -1) {
            return null;
        }

        const landmarks =
            this.results.multiHandLandmarks[
                handIndex
            ];

        if (!landmarks) {
            return null;
        }

        return landmarks[index] || null;
    }

    // =========================================================
    // COORDINATES
    // =========================================================

    getX(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        return landmark
            ? landmark.x
            : 0;
    }

    getY(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        return landmark
            ? landmark.y
            : 0;
    }

    getZ(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        return landmark
            ? landmark.z
            : 0;
    }

    // =========================================================
    // WRIST
    // =========================================================

    wristX(args) {
        return this.getX(args.HAND, 0);
    }

    wristY(args) {
        return this.getY(args.HAND, 0);
    }

    wristZ(args) {
        return this.getZ(args.HAND, 0);
    }

    // =========================================================
    // THUMB
    // =========================================================

    thumbBottomX(args) {
        return this.getX(args.HAND, 1);
    }

    thumbBottomY(args) {
        return this.getY(args.HAND, 1);
    }

    thumbBottomZ(args) {
        return this.getZ(args.HAND, 1);
    }

    thumbMiddleX(args) {
        return this.getX(args.HAND, 2);
    }

    thumbMiddleY(args) {
        return this.getY(args.HAND, 2);
    }

    thumbMiddleZ(args) {
        return this.getZ(args.HAND, 2);
    }

    thumbTopX(args) {
        return this.getX(args.HAND, 3);
    }

    thumbTopY(args) {
        return this.getY(args.HAND, 3);
    }

    thumbTopZ(args) {
        return this.getZ(args.HAND, 3);
    }

    thumbTipX(args) {
        return this.getX(args.HAND, 4);
    }

    thumbTipY(args) {
        return this.getY(args.HAND, 4);
    }

    thumbTipZ(args) {
        return this.getZ(args.HAND, 4);
    }

    // =========================================================
    // INDEX
    // =========================================================

    indexBottomX(args) {
        return this.getX(args.HAND, 5);
    }

    indexBottomY(args) {
        return this.getY(args.HAND, 5);
    }

    indexBottomZ(args) {
        return this.getZ(args.HAND, 5);
    }

    indexMiddleX(args) {
        return this.getX(args.HAND, 6);
    }

    indexMiddleY(args) {
        return this.getY(args.HAND, 6);
    }

    indexMiddleZ(args) {
        return this.getZ(args.HAND, 6);
    }

    indexTopX(args) {
        return this.getX(args.HAND, 7);
    }

    indexTopY(args) {
        return this.getY(args.HAND, 7);
    }

    indexTopZ(args) {
        return this.getZ(args.HAND, 7);
    }

    indexTipX(args) {
        return this.getX(args.HAND, 8);
    }

    indexTipY(args) {
        return this.getY(args.HAND, 8);
    }

    indexTipZ(args) {
        return this.getZ(args.HAND, 8);
    }

    // =========================================================
    // MIDDLE
    // =========================================================

    middleBottomX(args) {
        return this.getX(args.HAND, 9);
    }

    middleBottomY(args) {
        return this.getY(args.HAND, 9);
    }

    middleBottomZ(args) {
        return this.getZ(args.HAND, 9);
    }

    middleMiddleX(args) {
        return this.getX(args.HAND, 10);
    }

    middleMiddleY(args) {
        return this.getY(args.HAND, 10);
    }

    middleMiddleZ(args) {
        return this.getZ(args.HAND, 10);
    }

    middleTopX(args) {
        return this.getX(args.HAND, 11);
    }

    middleTopY(args) {
        return this.getY(args.HAND, 11);
    }

    middleTopZ(args) {
        return this.getZ(args.HAND, 11);
    }

    middleTipX(args) {
        return this.getX(args.HAND, 12);
    }

    middleTipY(args) {
        return this.getY(args.HAND, 12);
    }

    middleTipZ(args) {
        return this.getZ(args.HAND, 12);
    }

    // =========================================================
    // RING
    // =========================================================

    ringBottomX(args) {
        return this.getX(args.HAND, 13);
    }

    ringBottomY(args) {
        return this.getY(args.HAND, 13);
    }

    ringBottomZ(args) {
        return this.getZ(args.HAND, 13);
    }

    ringMiddleX(args) {
        return this.getX(args.HAND, 14);
    }

    ringMiddleY(args) {
        return this.getY(args.HAND, 14);
    }

    ringMiddleZ(args) {
        return this.getZ(args.HAND, 14);
    }

    ringTopX(args) {
        return this.getX(args.HAND, 15);
    }

    ringTopY(args) {
        return this.getY(args.HAND, 15);
    }

    ringTopZ(args) {
        return this.getZ(args.HAND, 15);
    }

    ringTipX(args) {
        return this.getX(args.HAND, 16);
    }

    ringTipY(args) {
        return this.getY(args.HAND, 16);
    }

    ringTipZ(args) {
        return this.getZ(args.HAND, 16);
    }

    // =========================================================
    // PINKY
    // =========================================================

    pinkyBottomX(args) {
        return this.getX(args.HAND, 17);
    }

    pinkyBottomY(args) {
        return this.getY(args.HAND, 17);
    }

    pinkyBottomZ(args) {
        return this.getZ(args.HAND, 17);
    }

    pinkyMiddleX(args) {
        return this.getX(args.HAND, 18);
    }

    pinkyMiddleY(args) {
        return this.getY(args.HAND, 18);
    }

    pinkyMiddleZ(args) {
        return this.getZ(args.HAND, 18);
    }

    pinkyTopX(args) {
        return this.getX(args.HAND, 19);
    }

    pinkyTopY(args) {
        return this.getY(args.HAND, 19);
    }

    pinkyTopZ(args) {
        return this.getZ(args.HAND, 19);
    }

    pinkyTipX(args) {
        return this.getX(args.HAND, 20);
    }

    pinkyTipY(args) {
        return this.getY(args.HAND, 20);
    }

    pinkyTipZ(args) {
        return this.getZ(args.HAND, 20);
    }

    // =========================================================
    // BLOCKS
    // =========================================================

    getInfo() {
        const blocks = [
            {
                opcode: "startHandTracking",
                blockType: "command",
                text: "start hand tracking"
            },

            {
                opcode: "stopHandTracking",
                blockType: "command",
                text: "stop hand tracking"
            },

            {
                opcode: "cameraActive",
                blockType: "Boolean",
                text: "camera active?"
            },

            {
                opcode: "getNumberOfHands",
                blockType: "reporter",
                text: "number of hands"
            },

            {
                opcode: "handDetected",
                blockType: "Boolean",
                text: "[HAND] hand detected?",

                arguments: {
                    HAND: {
                        type: "string",
                        menu: "hands"
                    }
                }
            }
        ];

        const landmarks = [
            ["wrist", "wrist", 0],

            ["thumbBottom", "thumb bottom joint", 1],
            ["thumbMiddle", "thumb middle joint", 2],
            ["thumbTop", "thumb top joint", 3],
            ["thumbTip", "thumb tip", 4],

            ["indexBottom", "index bottom joint", 5],
            ["indexMiddle", "index middle joint", 6],
            ["indexTop", "index top joint", 7],
            ["indexTip", "index tip", 8],

            ["middleBottom", "middle bottom joint", 9],
            ["middleMiddle", "middle middle joint", 10],
            ["middleTop", "middle top joint", 11],
            ["middleTip", "middle tip", 12],

            ["ringBottom", "ring bottom joint", 13],
            ["ringMiddle", "ring middle joint", 14],
            ["ringTop", "ring top joint", 15],
            ["ringTip", "ring tip", 16],

            ["pinkyBottom", "pinky bottom joint", 17],
            ["pinkyMiddle", "pinky middle joint", 18],
            ["pinkyTop", "pinky top joint", 19],
            ["pinkyTip", "pinky tip", 20]
        ];

        for (const landmark of landmarks) {
            const name = landmark[0];
            const displayName = landmark[1];

            blocks.push({
                opcode: name + "X",
                blockType: "reporter",

                text:
                    "[HAND] " +
                    displayName +
                    " x",

                arguments: {
                    HAND: {
                        type: "string",
                        menu: "hands"
                    }
                }
            });

            blocks.push({
                opcode: name + "Y",
                blockType: "reporter",

                text:
                    "[HAND] " +
                    displayName +
                    " y",

                arguments: {
                    HAND: {
                        type: "string",
                        menu: "hands"
                    }
                }
            });

            blocks.push({
                opcode: name + "Z",
                blockType: "reporter",

                text:
                    "[HAND] " +
                    displayName +
                    " z",

                arguments: {
                    HAND: {
                        type: "string",
                        menu: "hands"
                    }
                }
            });
        }

        return {
            id: "handtracking",

            name: "Hand Tracking",

            color1: "#5B5BFF",
            color2: "#4747CC",
            color3: "#333399",

            blocks: blocks,

            menus: {
                hands: {
                    acceptReporters: true,

                    items: [
                        {
                            text: "left",
                            value: "Left"
                        },

                        {
                            text: "right",
                            value: "Right"
                        }
                    ]
                }
            }
        };
    }
}


// =============================================================
// UNSANDBOXED
// =============================================================

if (!Scratch.extensions.unsandboxed) {
    throw new Error(
        "The Hand Tracking extension must run unsandboxed."
    );
}


// =============================================================
// REGISTER
// =============================================================

Scratch.extensions.register(
    new HandTrackingExtension()
);
