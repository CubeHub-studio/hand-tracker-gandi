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
        this.handLandmarker = null;
        this.running = false;
        this.loadingPromise = null;
        this.lastResults = null;
        this.lastVideoTime = -1;
    }

    async loadMediaPipe() {
        if (this.handLandmarker) {
            return this.handLandmarker;
        }

        if (this.loadingPromise) {
            return this.loadingPromise;
        }

        this.loadingPromise = (async () => {
            try {
                const vision = await import(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs"
                );

                const {
                    HandLandmarker,
                    FilesetResolver
                } = vision;

                const filesetResolver =
                    await FilesetResolver.forVisionTasks(
                        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
                    );

                this.handLandmarker =
                    await HandLandmarker.createFromOptions(
                        filesetResolver,
                        {
                            baseOptions: {
                                modelAssetPath:
                                    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                                delegate: "GPU"
                            },

                            runningMode: "VIDEO",

                            numHands: 2,

                            minHandDetectionConfidence: 0.5,
                            minHandPresenceConfidence: 0.5,
                            minTrackingConfidence: 0.5
                        }
                    );

                return this.handLandmarker;
            } catch (error) {
                this.loadingPromise = null;
                console.error("MediaPipe loading error:", error);
                throw error;
            }
        })();

        return this.loadingPromise;
    }

    async startCamera() {
        if (this.running) {
            return;
        }

        try {
            /*
             * Request the camera FIRST.
             *
             * This is intentionally done directly from the block's
             * action so the browser can associate the permission
             * request with the user's interaction.
             */
            if (!this.stream) {
                this.stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: {
                            ideal: 640
                        },
                        height: {
                            ideal: 480
                        },
                        facingMode: "user"
                    },
                    audio: false
                });

                this.video.srcObject = this.stream;

                await this.video.play();
            }

            /*
             * Load MediaPipe after the camera is active.
             */
            await this.loadMediaPipe();

            this.running = true;
            this.lastVideoTime = -1;

            this.processFrame();

        } catch (error) {
            console.error("Hand tracking start error:", error);

            this.running = false;

            if (this.stream) {
                for (const track of this.stream.getTracks()) {
                    track.stop();
                }

                this.stream = null;
                this.video.srcObject = null;
            }

            throw error;
        }
    }

    stopCamera() {
        this.running = false;

        if (this.stream) {
            for (const track of this.stream.getTracks()) {
                track.stop();
            }

            this.stream = null;
        }

        this.video.srcObject = null;
        this.lastResults = null;
        this.lastVideoTime = -1;
    }

    processFrame() {
        if (!this.running) {
            return;
        }

        if (
            this.handLandmarker &&
            this.video.readyState >= 2 &&
            this.video.videoWidth > 0
        ) {
            try {
                const currentTime = this.video.currentTime;

                if (currentTime !== this.lastVideoTime) {
                    this.lastVideoTime = currentTime;

                    this.lastResults =
                        this.handLandmarker.detectForVideo(
                            this.video,
                            performance.now()
                        );
                }
            } catch (error) {
                console.error("Hand detection error:", error);
            }
        }

        requestAnimationFrame(() => this.processFrame());
    }

    cameraActive() {
        return this.running;
    }

    getNumberOfHands() {
        if (!this.lastResults) {
            return 0;
        }

        if (!this.lastResults.landmarks) {
            return 0;
        }

        return this.lastResults.landmarks.length;
    }

    getHandIndex(hand) {
        if (!this.lastResults) {
            return -1;
        }

        if (
            !this.lastResults.handednesses ||
            !this.lastResults.handednesses.length
        ) {
            return -1;
        }

        const wanted = String(hand).toLowerCase();

        for (
            let i = 0;
            i < this.lastResults.handednesses.length;
            i++
        ) {
            const handedness = this.lastResults.handednesses[i];

            if (!handedness || !handedness.length) {
                continue;
            }

            const label =
                String(handedness[0].categoryName).toLowerCase();

            if (label === wanted) {
                return i;
            }
        }

        return -1;
    }

    handDetected(hand) {
        return this.getHandIndex(hand) !== -1;
    }

    getLandmark(hand, index) {
        const handIndex = this.getHandIndex(hand);

        if (handIndex === -1) {
            return null;
        }

        if (!this.lastResults || !this.lastResults.landmarks) {
            return null;
        }

        const handLandmarks =
            this.lastResults.landmarks[handIndex];

        if (!handLandmarks) {
            return null;
        }

        const landmark = handLandmarks[index];

        if (!landmark) {
            return null;
        }

        return landmark;
    }

    getX(hand, index) {
        const landmark = this.getLandmark(hand, index);

        if (!landmark) {
            return 0;
        }

        return landmark.x;
    }

    getY(hand, index) {
        const landmark = this.getLandmark(hand, index);

        if (!landmark) {
            return 0;
        }

        return landmark.y;
    }

    getZ(hand, index) {
        const landmark = this.getLandmark(hand, index);

        if (!landmark) {
            return 0;
        }

        return landmark.z;
    }

    getInfo() {
        return {
            id: "handtracking",

            name: "Hand Tracking",

            color1: "#5B5BFF",
            color2: "#4747CC",
            color3: "#333399",

            blocks: [

                // ==============================
                // CAMERA
                // ==============================

                {
                    opcode: "startCamera",
                    blockType: "command",
                    text: "start hand tracking"
                },

                {
                    opcode: "stopCamera",
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
                },

                // ==============================
                // WRIST
                // ==============================

                {
                    opcode: "wristX",
                    blockType: "reporter",
                    text: "[HAND] wrist x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "wristY",
                    blockType: "reporter",
                    text: "[HAND] wrist y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "wristZ",
                    blockType: "reporter",
                    text: "[HAND] wrist z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // THUMB BOTTOM
                // ==============================

                {
                    opcode: "thumbBottomX",
                    blockType: "reporter",
                    text: "[HAND] thumb bottom joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbBottomY",
                    blockType: "reporter",
                    text: "[HAND] thumb bottom joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbBottomZ",
                    blockType: "reporter",
                    text: "[HAND] thumb bottom joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // THUMB MIDDLE
                // ==============================

                {
                    opcode: "thumbMiddleX",
                    blockType: "reporter",
                    text: "[HAND] thumb middle joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbMiddleY",
                    blockType: "reporter",
                    text: "[HAND] thumb middle joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbMiddleZ",
                    blockType: "reporter",
                    text: "[HAND] thumb middle joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // THUMB TOP
                // ==============================

                {
                    opcode: "thumbTopX",
                    blockType: "reporter",
                    text: "[HAND] thumb top joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbTopY",
                    blockType: "reporter",
                    text: "[HAND] thumb top joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbTopZ",
                    blockType: "reporter",
                    text: "[HAND] thumb top joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // THUMB TIP
                // ==============================

                {
                    opcode: "thumbTipX",
                    blockType: "reporter",
                    text: "[HAND] thumb tip x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbTipY",
                    blockType: "reporter",
                    text: "[HAND] thumb tip y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbTipZ",
                    blockType: "reporter",
                    text: "[HAND] thumb tip z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // INDEX BOTTOM
                // ==============================

                {
                    opcode: "indexBottomX",
                    blockType: "reporter",
                    text: "[HAND] index bottom joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexBottomY",
                    blockType: "reporter",
                    text: "[HAND] index bottom joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexBottomZ",
                    blockType: "reporter",
                    text: "[HAND] index bottom joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // INDEX MIDDLE
                // ==============================

                {
                    opcode: "indexMiddleX",
                    blockType: "reporter",
                    text: "[HAND] index middle joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexMiddleY",
                    blockType: "reporter",
                    text: "[HAND] index middle joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexMiddleZ",
                    blockType: "reporter",
                    text: "[HAND] index middle joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // INDEX TOP
                // ==============================

                {
                    opcode: "indexTopX",
                    blockType: "reporter",
                    text: "[HAND] index top joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexTopY",
                    blockType: "reporter",
                    text: "[HAND] index top joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexTopZ",
                    blockType: "reporter",
                    text: "[HAND] index top joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // INDEX TIP
                // ==============================

                {
                    opcode: "indexTipX",
                    blockType: "reporter",
                    text: "[HAND] index tip x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexTipY",
                    blockType: "reporter",
                    text: "[HAND] index tip y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexTipZ",
                    blockType: "reporter",
                    text: "[HAND] index tip z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // MIDDLE BOTTOM
                // ==============================

                {
                    opcode: "middleBottomX",
                    blockType: "reporter",
                    text: "[HAND] middle bottom joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleBottomY",
                    blockType: "reporter",
                    text: "[HAND] middle bottom joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleBottomZ",
                    blockType: "reporter",
                    text: "[HAND] middle bottom joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // MIDDLE MIDDLE
                // ==============================

                {
                    opcode: "middleMiddleX",
                    blockType: "reporter",
                    text: "[HAND] middle middle joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleMiddleY",
                    blockType: "reporter",
                    text: "[HAND] middle middle joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleMiddleZ",
                    blockType: "reporter",
                    text: "[HAND] middle middle joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // MIDDLE TOP
                // ==============================

                {
                    opcode: "middleTopX",
                    blockType: "reporter",
                    text: "[HAND] middle top joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleTopY",
                    blockType: "reporter",
                    text: "[HAND] middle top joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleTopZ",
                    blockType: "reporter",
                    text: "[HAND] middle top joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // MIDDLE TIP
                // ==============================

                {
                    opcode: "middleTipX",
                    blockType: "reporter",
                    text: "[HAND] middle tip x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleTipY",
                    blockType: "reporter",
                    text: "[HAND] middle tip y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleTipZ",
                    blockType: "reporter",
                    text: "[HAND] middle tip z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // RING BOTTOM
                // ==============================

                {
                    opcode: "ringBottomX",
                    blockType: "reporter",
                    text: "[HAND] ring bottom joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringBottomY",
                    blockType: "reporter",
                    text: "[HAND] ring bottom joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringBottomZ",
                    blockType: "reporter",
                    text: "[HAND] ring bottom joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // RING MIDDLE
                // ==============================

                {
                    opcode: "ringMiddleX",
                    blockType: "reporter",
                    text: "[HAND] ring middle joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringMiddleY",
                    blockType: "reporter",
                    text: "[HAND] ring middle joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringMiddleZ",
                    blockType: "reporter",
                    text: "[HAND] ring middle joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // RING TOP
                // ==============================

                {
                    opcode: "ringTopX",
                    blockType: "reporter",
                    text: "[HAND] ring top joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringTopY",
                    blockType: "reporter",
                    text: "[HAND] ring top joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringTopZ",
                    blockType: "reporter",
                    text: "[HAND] ring top joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // RING TIP
                // ==============================

                {
                    opcode: "ringTipX",
                    blockType: "reporter",
                    text: "[HAND] ring tip x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringTipY",
                    blockType: "reporter",
                    text: "[HAND] ring tip y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringTipZ",
                    blockType: "reporter",
                    text: "[HAND] ring tip z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // PINKY BOTTOM
                // ==============================

                {
                    opcode: "pinkyBottomX",
                    blockType: "reporter",
                    text: "[HAND] pinky bottom joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyBottomY",
                    blockType: "reporter",
                    text: "[HAND] pinky bottom joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyBottomZ",
                    blockType: "reporter",
                    text: "[HAND] pinky bottom joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // PINKY MIDDLE
                // ==============================

                {
                    opcode: "pinkyMiddleX",
                    blockType: "reporter",
                    text: "[HAND] pinky middle joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyMiddleY",
                    blockType: "reporter",
                    text: "[HAND] pinky middle joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyMiddleZ",
                    blockType: "reporter",
                    text: "[HAND] pinky middle joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // PINKY TOP
                // ==============================

                {
                    opcode: "pinkyTopX",
                    blockType: "reporter",
                    text: "[HAND] pinky top joint x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyTopY",
                    blockType: "reporter",
                    text: "[HAND] pinky top joint y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyTopZ",
                    blockType: "reporter",
                    text: "[HAND] pinky top joint z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                // ==============================
                // PINKY TIP
                // ==============================

                {
                    opcode: "pinkyTipX",
                    blockType: "reporter",
                    text: "[HAND] pinky tip x",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyTipY",
                    blockType: "reporter",
                    text: "[HAND] pinky tip y",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyTipZ",
                    blockType: "reporter",
                    text: "[HAND] pinky tip z",
                    arguments: {
                        HAND: {
                            type: "string",
                            menu: "hands"
                        }
                    }
                }
            ],

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

    // ==============================
    // CAMERA BLOCKS
    // ==============================

    async startCamera() {
        await this.startCamera();
    }

    stopCameraBlock() {
        this.stopCamera();
    }

    // ==============================
    // WRIST
    // ==============================

    wristX(args) {
        return this.getX(args.HAND, 0);
    }

    wristY(args) {
        return this.getY(args.HAND, 0);
    }

    wristZ(args) {
        return this.getZ(args.HAND, 0);
    }

    // ==============================
    // THUMB
    // ==============================

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

    // ==============================
    // INDEX
    // ==============================

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

    // ==============================
    // MIDDLE
    // ==============================

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

    // ==============================
    // RING
    // ==============================

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

    // ==============================
    // PINKY
    // ==============================

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
}


// ============================================================
// IMPORTANT:
// The command block cannot have the same name as the internal
// startCamera() function, so we create wrapper methods here.
// ============================================================

const extension = new HandTrackingExtension();

extension.startHandTracking = async function () {
    await HandTrackingExtension.prototype.startCamera.call(this);
};

extension.stopHandTracking = function () {
    HandTrackingExtension.prototype.stopCamera.call(this);
};

extension.isCameraActive = function () {
    return this.cameraActive();
};


// ============================================================
// Map the Scratch/Gandi opcodes to the actual functions.
// ============================================================

extension.getInfo = function () {
    const info = HandTrackingExtension.prototype.getInfo.call(this);

    info.blocks = info.blocks.map(block => {
        if (block.opcode === "startCamera") {
            block.opcode = "startHandTracking";
        }

        if (block.opcode === "stopCamera") {
            block.opcode = "stopHandTracking";
        }

        if (block.opcode === "cameraActive") {
            block.opcode = "isCameraActive";
        }

        return block;
    });

    return info;
};


// ============================================================
// Register
// ============================================================

if (!Scratch.extensions.unsandboxed) {
    throw new Error(
        "The Hand Tracking extension must run unsandboxed."
    );
}

Scratch.extensions.register(extension);
