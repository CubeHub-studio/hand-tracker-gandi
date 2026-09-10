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

        // =====================================================
        // MEMORY SAFETY
        // =====================================================

        // Never process more than one MediaPipe frame at once.
        this.processing = false;

        // Approximately 30 FPS.
        this.lastProcessTime = 0;
        this.processInterval = 33;

        this.animationFrame = null;

        // Prevent stale camera sessions.
        this.session = 0;
    }

    // =========================================================
    // LOAD MEDIAPIPE WITH A NORMAL <script> TAG
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

                const onLoad = () => {
                    cleanup();
                    resolve();
                };

                const onError = () => {
                    cleanup();

                    reject(
                        new Error(
                            "Failed to load MediaPipe Hands."
                        )
                    );
                };

                const cleanup = () => {
                    existing.removeEventListener(
                        "load",
                        onLoad
                    );

                    existing.removeEventListener(
                        "error",
                        onError
                    );
                };

                existing.addEventListener(
                    "load",
                    onLoad
                );

                existing.addEventListener(
                    "error",
                    onError
                );

                return;
            }

            const script =
                document.createElement("script");

            script.src = url;
            script.async = true;
            script.crossOrigin = "anonymous";

            script.dataset.handTrackingMediapipe =
                "true";

            script.onload = () => {
                resolve();
            };

            script.onerror = () => {
                reject(
                    new Error(
                        "Failed to load MediaPipe Hands."
                    )
                );
            };

            document.head.appendChild(script);
        });
    }

    // =========================================================
    // LOAD MEDIAPIPE
    // =========================================================

    async loadMediaPipe() {
        if (
            this.mediaPipeLoaded &&
            this.hands
        ) {
            return;
        }

        if (this.loading) {
            while (this.loading) {
                await new Promise(resolve =>
                    setTimeout(resolve, 50)
                );
            }

            if (
                this.mediaPipeLoaded &&
                this.hands
            ) {
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
                    "MediaPipe Hands was not found."
                );
            }

            this.hands =
                new window.Hands({
                    locateFile: file => {
                        return (
                            "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/" +
                            file
                        );
                    }
                });

            // =================================================
            // HIGH ACCURACY SETTINGS
            // =================================================

            this.hands.setOptions({
                maxNumHands: 2,

                modelComplexity: 1,

                minDetectionConfidence: 0.65,

                minTrackingConfidence: 0.65
            });

            this.hands.onResults(
                results => {
                    /*
                     * Replace the previous result.
                     * Never accumulate results.
                     */
                    this.results = results;

                    /*
                     * Allow exactly one new frame.
                     */
                    this.processing = false;
                }
            );

            this.mediaPipeLoaded = true;

        } catch (error) {
            this.hands = null;
            this.mediaPipeLoaded = false;

            throw error;

        } finally {
            this.loading = false;
        }
    }

    // =========================================================
    // START HAND TRACKING
    // =========================================================

    async startHandTracking() {
        if (this.running) {
            return;
        }

        const currentSession =
            ++this.session;

        try {
            if (
                !navigator.mediaDevices ||
                !navigator.mediaDevices.getUserMedia
            ) {
                throw new Error(
                    "Camera access is not supported."
                );
            }

            // =================================================
            // CAMERA
            // =================================================

            this.stream =
                await navigator.mediaDevices
                    .getUserMedia({
                        video: {
                            width: {
                                ideal: 640,
                                max: 640
                            },

                            height: {
                                ideal: 480,
                                max: 480
                            },

                            frameRate: {
                                ideal: 30,
                                max: 30
                            },

                            facingMode: "user"
                        },

                        audio: false
                    });

            /*
             * If the user stopped tracking while the
             * camera permission dialog was open.
             */
            if (
                currentSession !==
                this.session
            ) {
                for (
                    const track of
                    this.stream.getTracks()
                ) {
                    track.stop();
                }

                this.stream = null;

                return;
            }

            this.video.srcObject =
                this.stream;

            await this.video.play();

            // =================================================
            // MEDIAPIPE
            // =================================================

            await this.loadMediaPipe();

            if (
                currentSession !==
                this.session
            ) {
                return;
            }

            this.running = true;

            this.processing = false;

            this.lastProcessTime = 0;

            this.results = null;

            this.processLoop();

        } catch (error) {
            console.error(
                "Hand Tracking failed:",
                error
            );

            this.stopHandTracking();

            throw error;
        }
    }

    // =========================================================
    // STOP HAND TRACKING
    // =========================================================

    stopHandTracking() {
        this.session++;

        this.running = false;

        if (
            this.animationFrame !== null
        ) {
            cancelAnimationFrame(
                this.animationFrame
            );

            this.animationFrame = null;
        }

        this.processing = false;

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

        const now =
            performance.now();

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
         * MEMORY SAFETY:
         *
         * If MediaPipe is still processing a frame,
         * skip this frame completely.
         */
        if (this.processing) {
            return;
        }

        if (!this.running) {
            return;
        }

        if (!this.hands) {
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

        /*
         * Lock before sending the frame.
         */
        this.processing = true;

        try {
            await this.hands.send({
                image: this.video
            });

        } catch (error) {
            console.error(
                "MediaPipe frame error:",
                error
            );

            /*
             * Never leave the processor locked.
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

        if (
            !this.results.multiHandLandmarks
        ) {
            return 0;
        }

        return (
            this.results.multiHandLandmarks
                .length
        );
    }

    // =========================================================
    // FIND LEFT / RIGHT HAND
    // =========================================================

    getHandIndex(hand) {
        if (!this.results) {
            return -1;
        }

        if (
            !this.results.multiHandedness
        ) {
            return -1;
        }

        const wanted =
            String(hand || "")
                .toLowerCase();

        for (
            let i = 0;
            i <
            this.results.multiHandedness
                .length;
            i++
        ) {
            const handedness =
                this.results
                    .multiHandedness[i];

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
                handedness
                    .classification
                    .length > 0
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

    getLandmark(
        hand,
        index
    ) {
        if (!this.results) {
            return null;
        }

        if (
            !this.results
                .multiHandLandmarks
        ) {
            return null;
        }

        const handIndex =
            this.getHandIndex(
                hand
            );

        if (handIndex === -1) {
            return null;
        }

        const landmarks =
            this.results
                .multiHandLandmarks[
                    handIndex
                ];

        if (!landmarks) {
            return null;
        }

        if (
            index < 0 ||
            index >= landmarks.length
        ) {
            return null;
        }

        return (
            landmarks[index] ||
            null
        );
    }

    // =========================================================
    // X COORDINATE
    //
    // MediaPipe:
    //     0.0 = left
    //     0.5 = center
    //     1.0 = right
    //
    // Gandi/Scratch:
    //     -240 = left
    //        0 = center
    //      240 = right
    // =========================================================

    getX(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        if (!landmark) {
            return 0;
        }

        const normalized =
            Number(
                landmark.x
            );

        if (!Number.isFinite(normalized)) {
            return 0;
        }

        /*
         * Convert:
         *
         * 0.0  -> -240
         * 0.5  ->    0
         * 1.0  ->  240
         */
        return (
            (normalized - 0.5) *
            480
        );
    }

    // =========================================================
    // Y COORDINATE
    //
    // MediaPipe:
    //     0.0 = top
    //     0.5 = center
    //     1.0 = bottom
    //
    // Gandi/Scratch:
    //     180 = top
    //       0 = center
    //    -180 = bottom
    // =========================================================

    getY(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        if (!landmark) {
            return 0;
        }

        const normalized =
            Number(
                landmark.y
            );

        if (!Number.isFinite(normalized)) {
            return 0;
        }

        /*
         * Invert Y because computer vision
         * coordinates increase downward.
         *
         * 0.0  ->  180
         * 0.5  ->    0
         * 1.0  -> -180
         */
        return (
            180 -
            normalized * 360
        );
    }

    // =========================================================
    // Z COORDINATE
    //
    // Z stays as MediaPipe's depth value.
    // =========================================================

    getZ(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        if (!landmark) {
            return 0;
        }

        const z =
            Number(
                landmark.z
            );

        if (!Number.isFinite(z)) {
            return 0;
        }

        return z;
    }

    // =========================================================
    // WRIST
    // =========================================================

    wristX(args) {
        return this.getX(
            args.HAND,
            0
        );
    }

    wristY(args) {
        return this.getY(
            args.HAND,
            0
        );
    }

    wristZ(args) {
        return this.getZ(
            args.HAND,
            0
        );
    }

    // =========================================================
    // THUMB
    // =========================================================

    thumbBottomX(args) {
        return this.getX(
            args.HAND,
            1
        );
    }

    thumbBottomY(args) {
        return this.getY(
            args.HAND,
            1
        );
    }

    thumbBottomZ(args) {
        return this.getZ(
            args.HAND,
            1
        );
    }

    thumbMiddleX(args) {
        return this.getX(
            args.HAND,
            2
        );
    }

    thumbMiddleY(args) {
        return this.getY(
            args.HAND,
            2
        );
    }

    thumbMiddleZ(args) {
        return this.getZ(
            args.HAND,
            2
        );
    }

    thumbTopX(args) {
        return this.getX(
            args.HAND,
            3
        );
    }

    thumbTopY(args) {
        return this.getY(
            args.HAND,
            3
        );
    }

    thumbTopZ(args) {
        return this.getZ(
            args.HAND,
            3
        );
    }

    thumbTipX(args) {
        return this.getX(
            args.HAND,
            4
        );
    }

    thumbTipY(args) {
        return this.getY(
            args.HAND,
            4
        );
    }

    thumbTipZ(args) {
        return this.getZ(
            args.HAND,
            4
        );
    }

    // =========================================================
    // INDEX
    // =========================================================

    indexBottomX(args) {
        return this.getX(
            args.HAND,
            5
        );
    }

    indexBottomY(args) {
        return this.getY(
            args.HAND,
            5
        );
    }

    indexBottomZ(args) {
        return this.getZ(
            args.HAND,
            5
        );
    }

    indexMiddleX(args) {
        return this.getX(
            args.HAND,
            6
        );
    }

    indexMiddleY(args) {
        return this.getY(
            args.HAND,
            6
        );
    }

    indexMiddleZ(args) {
        return this.getZ(
            args.HAND,
            6
        );
    }

    indexTopX(args) {
        return this.getX(
            args.HAND,
            7
        );
    }

    indexTopY(args) {
        return this.getY(
            args.HAND,
            7
        );
    }

    indexTopZ(args) {
        return this.getZ(
            args.HAND,
            7
        );
    }

    indexTipX(args) {
        return this.getX(
            args.HAND,
            8
        );
    }

    indexTipY(args) {
        return this.getY(
            args.HAND,
            8
        );
    }

    indexTipZ(args) {
        return this.getZ(
            args.HAND,
            8
        );
    }

    // =========================================================
    // MIDDLE
    // =========================================================

    middleBottomX(args) {
        return this.getX(
            args.HAND,
            9
        );
    }

    middleBottomY(args) {
        return this.getY(
            args.HAND,
            9
        );
    }

    middleBottomZ(args) {
        return this.getZ(
            args.HAND,
            9
        );
    }

    middleMiddleX(args) {
        return this.getX(
            args.HAND,
            10
        );
    }

    middleMiddleY(args) {
        return this.getY(
            args.HAND,
            10
        );
    }

    middleMiddleZ(args) {
        return this.getZ(
            args.HAND,
            10
        );
    }

    middleTopX(args) {
        return this.getX(
            args.HAND,
            11
        );
    }

    middleTopY(args) {
        return this.getY(
            args.HAND,
            11
        );
    }

    middleTopZ(args) {
        return this.getZ(
            args.HAND,
            11
        );
    }

    middleTipX(args) {
        return this.getX(
            args.HAND,
            12
        );
    }

    middleTipY(args) {
        return this.getY(
            args.HAND,
            12
        );
    }

    middleTipZ(args) {
        return this.getZ(
            args.HAND,
            12
        );
    }

    // =========================================================
    // RING
    // =========================================================

    ringBottomX(args) {
        return this.getX(
            args.HAND,
            13
        );
    }

    ringBottomY(args) {
        return this.getY(
            args.HAND,
            13
        );
    }

    ringBottomZ(args) {
        return this.getZ(
            args.HAND,
            13
        );
    }

    ringMiddleX(args) {
        return this.getX(
            args.HAND,
            14
        );
    }

    ringMiddleY(args) {
        return this.getY(
            args.HAND,
            14
        );
    }

    ringMiddleZ(args) {
        return this.getZ(
            args.HAND,
            14
        );
    }

    ringTopX(args) {
        return this.getX(
            args.HAND,
            15
        );
    }

    ringTopY(args) {
        return this.getY(
            args.HAND,
            15
        );
    }

    ringTopZ(args) {
        return this.getZ(
            args.HAND,
            15
        );
    }

    ringTipX(args) {
        return this.getX(
            args.HAND,
            16
        );
    }

    ringTipY(args) {
        return this.getY(
            args.HAND,
            16
        );
    }

    ringTipZ(args) {
        return this.getZ(
            args.HAND,
            16
        );
    }

    // =========================================================
    // PINKY
    // =========================================================

    pinkyBottomX(args) {
        return this.getX(
            args.HAND,
            17
        );
    }

    pinkyBottomY(args) {
        return this.getY(
            args.HAND,
            17
        );
    }

    pinkyBottomZ(args) {
        return this.getZ(
            args.HAND,
            17
        );
    }

    pinkyMiddleX(args) {
        return this.getX(
            args.HAND,
            18
        );
    }

    pinkyMiddleY(args) {
        return this.getY(
            args.HAND,
            18
        );
    }

    pinkyMiddleZ(args) {
        return this.getZ(
            args.HAND,
            18
        );
    }

    pinkyTopX(args) {
        return this.getX(
            args.HAND,
            19
        );
    }

    pinkyTopY(args) {
        return this.getY(
            args.HAND,
            19
        );
    }

    pinkyTopZ(args) {
        return this.getZ(
            args.HAND,
            19
        );
    }

    pinkyTipX(args) {
        return this.getX(
            args.HAND,
            20
        );
    }

    pinkyTipY(args) {
        return this.getY(
            args.HAND,
            20
        );
    }

    pinkyTipZ(args) {
        return this.getZ(
            args.HAND,
            20
        );
    }

    // =========================================================
    // BLOCK DEFINITIONS
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

        // =====================================================
        // EXACT 21 LANDMARKS
        // =====================================================

        const landmarks = [
            ["wrist", "wrist", 0],

            [
                "thumbBottom",
                "thumb bottom joint",
                1
            ],

            [
                "thumbMiddle",
                "thumb middle joint",
                2
            ],

            [
                "thumbTop",
                "thumb top joint",
                3
            ],

            [
                "thumbTip",
                "thumb tip",
                4
            ],

            [
                "indexBottom",
                "index bottom joint",
                5
            ],

            [
                "indexMiddle",
                "index middle joint",
                6
            ],

            [
                "indexTop",
                "index top joint",
                7
            ],

            [
                "indexTip",
                "index tip",
                8
            ],

            [
                "middleBottom",
                "middle bottom joint",
                9
            ],

            [
                "middleMiddle",
                "middle middle joint",
                10
            ],

            [
                "middleTop",
                "middle top joint",
                11
            ],

            [
                "middleTip",
                "middle tip",
                12
            ],

            [
                "ringBottom",
                "ring bottom joint",
                13
            ],

            [
                "ringMiddle",
                "ring middle joint",
                14
            ],

            [
                "ringTop",
                "ring top joint",
                15
            ],

            [
                "ringTip",
                "ring tip",
                16
            ],

            [
                "pinkyBottom",
                "pinky bottom joint",
                17
            ],

            [
                "pinkyMiddle",
                "pinky middle joint",
                18
            ],

            [
                "pinkyTop",
                "pinky top joint",
                19
            ],

            [
                "pinkyTip",
                "pinky tip",
                20
            ]
        ];

        // =====================================================
        // GENERATE X / Y / Z REPORTERS
        // =====================================================

        for (
            const landmark of landmarks
        ) {
            const name =
                landmark[0];

            const displayName =
                landmark[1];

            blocks.push({
                opcode:
                    name + "X",

                blockType:
                    "reporter",

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
                opcode:
                    name + "Y",

                blockType:
                    "reporter",

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
                opcode:
                    name + "Z",

                blockType:
                    "reporter",

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
// REQUIRE UNSANDBOXED MODE
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
