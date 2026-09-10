(function (Scratch) {
    "use strict";

    /*
     * Gandi Hand Tracking
     *
     * Requires:
     * - Unsandboxed extension support
     * - Browser camera permission
     * - Internet connection for the MediaPipe libraries/model
     *
     * Every hand landmark has its own X, Y and Z reporter.
     */

    if (!Scratch.extensions.unsandboxed) {
        throw new Error(
            "Hand Tracking must run as an unsandboxed extension."
        );
    }

    const EXTENSION_ID = "gandiHandTracking";

    const MEDIAPIPE_VERSION = "0.10.22";

    const MEDIAPIPE_URL =
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" +
        MEDIAPIPE_VERSION +
        "/vision_bundle.mjs";

    const WASM_URL =
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" +
        MEDIAPIPE_VERSION +
        "/wasm";

    const MODEL_URL =
        "https://storage.googleapis.com/mediapipe-models/" +
        "hand_landmarker/hand_landmarker/float16/1/" +
        "hand_landmarker.task";


    /*
     * MediaPipe landmark numbers.
     *
     * These are deliberately named using the terminology
     * requested for the Gandi blocks.
     */
    const LANDMARKS = [
        "wrist",

        "thumb bottom joint",
        "thumb middle joint",
        "thumb top joint",
        "thumb tip",

        "index bottom joint",
        "index middle joint",
        "index top joint",
        "index tip",

        "middle bottom joint",
        "middle middle joint",
        "middle top joint",
        "middle tip",

        "ring bottom joint",
        "ring middle joint",
        "ring top joint",
        "ring tip",

        "pinky bottom joint",
        "pinky middle joint",
        "pinky top joint",
        "pinky tip"
    ];


    class HandTracking {

        constructor() {

            this.video = null;

            this.stream = null;

            this.handLandmarker = null;

            this.running = false;

            this.loading = false;

            this.initializingCamera = false;

            this.lastVideoTime = -1;

            this.results = null;

            this.leftHand = null;

            this.rightHand = null;

            this.cameraError = "";

            this.mediaPipeLoaded = false;

            this._createVideo();

            /*
             * Start loading immediately.
             *
             * requestCamera() will explicitly call
             * getUserMedia(), causing the browser's
             * camera permission prompt when appropriate.
             */
            this.initialize();
        }


        _createVideo() {

            this.video = document.createElement("video");

            this.video.autoplay = true;

            this.video.muted = true;

            this.video.playsInline = true;

            /*
             * The camera is used for detection but doesn't
             * need to appear on the stage.
             */
            this.video.style.position = "fixed";

            this.video.style.left = "-10000px";

            this.video.style.top = "-10000px";

            this.video.style.width = "640px";

            this.video.style.height = "480px";

            this.video.style.opacity = "0";

            this.video.style.pointerEvents = "none";

            this.video.setAttribute(
                "aria-hidden",
                "true"
            );

            document.body.appendChild(this.video);
        }


        async initialize() {

            if (this.loading) {
                return;
            }

            this.loading = true;

            try {

                const MediaPipe =
                    await import(MEDIAPIPE_URL);

                const FilesetResolver =
                    MediaPipe.FilesetResolver;

                const HandLandmarker =
                    MediaPipe.HandLandmarker;


                const vision =
                    await FilesetResolver.forVisionTasks(
                        WASM_URL
                    );


                this.handLandmarker =
                    await HandLandmarker.createFromOptions(
                        vision,
                        {
                            baseOptions: {
                                modelAssetPath: MODEL_URL,
                                delegate: "GPU"
                            },

                            runningMode: "VIDEO",

                            numHands: 2,

                            minHandDetectionConfidence: 0.5,

                            minHandPresenceConfidence: 0.5,

                            minTrackingConfidence: 0.5
                        }
                    );


                this.mediaPipeLoaded = true;

                console.log(
                    "[Gandi Hand Tracking] MediaPipe loaded."
                );


                /*
                 * Explicitly request the camera after
                 * MediaPipe has loaded.
                 */
                await this.requestCamera();

            } catch (error) {

                this.cameraError =
                    String(error);

                console.error(
                    "[Gandi Hand Tracking]",
                    error
                );

            } finally {

                this.loading = false;
            }
        }


        async requestCamera() {

            if (this.initializingCamera) {
                return;
            }

            this.initializingCamera = true;

            this.cameraError = "";

            try {

                if (
                    !navigator.mediaDevices ||
                    !navigator.mediaDevices.getUserMedia
                ) {

                    throw new Error(
                        "This browser does not provide getUserMedia()."
                    );
                }


                /*
                 * THIS is the actual camera permission request.
                 */
                const stream =
                    await navigator.mediaDevices.getUserMedia({
                        video: {
                            width: {
                                ideal: 640
                            },

                            height: {
                                ideal: 480
                            },

                            frameRate: {
                                ideal: 30
                            },

                            facingMode: "user"
                        },

                        audio: false
                    });


                this.stream = stream;

                this.video.srcObject = stream;


                await this.video.play();


                this.running = true;


                console.log(
                    "[Gandi Hand Tracking] Camera permission granted."
                );


                this.processFrame();


            } catch (error) {

                this.cameraError =
                    String(error);

                console.error(
                    "[Gandi Hand Tracking] Camera error:",
                    error
                );

            } finally {

                this.initializingCamera = false;
            }
        }


        startCamera() {

            if (this.running) {
                return;
            }

            if (!this.handLandmarker) {

                this.initialize();

                return;
            }

            this.requestCamera();
        }


        stopCamera() {

            this.running = false;

            this.leftHand = null;

            this.rightHand = null;

            this.results = null;

            if (this.stream) {

                for (
                    const track of this.stream.getTracks()
                ) {
                    track.stop();
                }

                this.stream = null;
            }

            if (this.video) {
                this.video.srcObject = null;
            }
        }


        async processFrame() {

            if (!this.running) {
                return;
            }


            if (
                this.handLandmarker &&
                this.video.readyState >= 2 &&
                this.video.currentTime !== this.lastVideoTime
            ) {

                this.lastVideoTime =
                    this.video.currentTime;


                try {

                    this.results =
                        this.handLandmarker.detectForVideo(
                            this.video,
                            performance.now()
                        );


                    this.updateHands();

                } catch (error) {

                    console.error(
                        "[Gandi Hand Tracking] Detection error:",
                        error
                    );
                }
            }


            requestAnimationFrame(
                () => this.processFrame()
            );
        }


        updateHands() {

            this.leftHand = null;

            this.rightHand = null;


            if (!this.results) {
                return;
            }


            const landmarks =
                this.results.landmarks || [];

            const handedness =
                this.results.handedness || [];


            for (
                let i = 0;
                i < landmarks.length;
                i++
            ) {

                const hand =
                    landmarks[i];

                const classification =
                    handedness[i] &&
                    handedness[i][0];


                if (!classification) {
                    continue;
                }


                const label =
                    classification.categoryName;


                if (label === "Left") {

                    this.leftHand = hand;

                } else if (label === "Right") {

                    this.rightHand = hand;
                }
            }
        }


        getHand(hand) {

            if (
                String(hand).toLowerCase() ===
                "right"
            ) {
                return this.rightHand;
            }

            return this.leftHand;
        }


        getLandmark(hand, index) {

            const selected =
                this.getHand(hand);


            if (
                !selected ||
                !selected[index]
            ) {
                return null;
            }


            return selected[index];
        }


        getCoordinate(hand, index, axis) {

            const point =
                this.getLandmark(
                    hand,
                    index
                );


            if (!point) {
                return 0;
            }


            return Number(point[axis]);
        }


        /*
         * ------------------------------------------------
         * GANDI BLOCKS
         * ------------------------------------------------
         */

        getInfo() {

            return {
                id: EXTENSION_ID,

                name: "Hand Tracking",

                color1: "#5B5BFF",

                color2: "#4545D8",

                color3: "#3030A8",

                blocks: [

                    {
                        opcode: "startCamera",

                        blockType:
                            Scratch.BlockType.COMMAND,

                        text: "start hand tracking"
                    },


                    {
                        opcode: "stopCamera",

                        blockType:
                            Scratch.BlockType.COMMAND,

                        text: "stop hand tracking"
                    },


                    {
                        opcode: "cameraAvailable",

                        blockType:
                            Scratch.BlockType.BOOLEAN,

                        text: "camera active?"
                    },


                    {
                        opcode: "leftHandDetected",

                        blockType:
                            Scratch.BlockType.BOOLEAN,

                        text: "left hand detected?"
                    },


                    {
                        opcode: "rightHandDetected",

                        blockType:
                            Scratch.BlockType.BOOLEAN,

                        text: "right hand detected?"
                    },


                    {
                        opcode: "numberOfHands",

                        blockType:
                            Scratch.BlockType.REPORTER,

                        text: "number of hands"
                    },


                    /*
                     * WRIST
                     */

                    {
                        opcode: "wristX",

                        blockType:
                            Scratch.BlockType.REPORTER,

                        text: "[HAND] wrist x",

                        arguments: {
                            HAND: {
                                type:
                                    Scratch.ArgumentType.STRING,

                                menu: "hands"
                            }
                        }
                    },


                    {
                        opcode: "wristY",

                        blockType:
                            Scratch.BlockType.REPORTER,

                        text: "[HAND] wrist y",

                        arguments: {
                            HAND: {
                                type:
                                    Scratch.ArgumentType.STRING,

                                menu: "hands"
                            }
                        }
                    },


                    {
                        opcode: "wristZ",

                        blockType:
                            Scratch.BlockType.REPORTER,

                        text: "[HAND] wrist z",

                        arguments: {
                            HAND: {
                                type:
                                    Scratch.ArgumentType.STRING,

                                menu: "hands"
                            }
                        }
                    },


                    /*
                     * THUMB
                     */

                    ...this.makeLandmarkBlocks(
                        "thumbBottom",
                        "thumb bottom joint",
                        1
                    ),

                    ...this.makeLandmarkBlocks(
                        "thumbMiddle",
                        "thumb middle joint",
                        2
                    ),

                    ...this.makeLandmarkBlocks(
                        "thumbTop",
                        "thumb top joint",
                        3
                    ),

                    ...this.makeLandmarkBlocks(
                        "thumbTip",
                        "thumb tip",
                        4
                    ),


                    /*
                     * INDEX
                     */

                    ...this.makeLandmarkBlocks(
                        "indexBottom",
                        "index bottom joint",
                        5
                    ),

                    ...this.makeLandmarkBlocks(
                        "indexMiddle",
                        "index middle joint",
                        6
                    ),

                    ...this.makeLandmarkBlocks(
                        "indexTop",
                        "index top joint",
                        7
                    ),

                    ...this.makeLandmarkBlocks(
                        "indexTip",
                        "index tip",
                        8
                    ),


                    /*
                     * MIDDLE
                     */

                    ...this.makeLandmarkBlocks(
                        "middleBottom",
                        "middle bottom joint",
                        9
                    ),

                    ...this.makeLandmarkBlocks(
                        "middleMiddle",
                        "middle middle joint",
                        10
                    ),

                    ...this.makeLandmarkBlocks(
                        "middleTop",
                        "middle top joint",
                        11
                    ),

                    ...this.makeLandmarkBlocks(
                        "middleTip",
                        "middle tip",
                        12
                    ),


                    /*
                     * RING
                     */

                    ...this.makeLandmarkBlocks(
                        "ringBottom",
                        "ring bottom joint",
                        13
                    ),

                    ...this.makeLandmarkBlocks(
                        "ringMiddle",
                        "ring middle joint",
                        14
                    ),

                    ...this.makeLandmarkBlocks(
                        "ringTop",
                        "ring top joint",
                        15
                    ),

                    ...this.makeLandmarkBlocks(
                        "ringTip",
                        "ring tip",
                        16
                    ),


                    /*
                     * PINKY
                     */

                    ...this.makeLandmarkBlocks(
                        "pinkyBottom",
                        "pinky bottom joint",
                        17
                    ),

                    ...this.makeLandmarkBlocks(
                        "pinkyMiddle",
                        "pinky middle joint",
                        18
                    ),

                    ...this.makeLandmarkBlocks(
                        "pinkyTop",
                        "pinky top joint",
                        19
                    ),

                    ...this.makeLandmarkBlocks(
                        "pinkyTip",
                        "pinky tip",
                        20
                    )
                ],


                menus: {

                    hands: {
                        acceptReporters: true,

                        items: [
                            "left",
                            "right"
                        ]
                    }
                }
            };
        }


        /*
         * Creates THREE SEPARATE blocks for one landmark:
         *
         * [left/right] index tip x
         * [left/right] index tip y
         * [left/right] index tip z
         */
        makeLandmarkBlocks(
            opcodePrefix,
            displayName,
            landmarkIndex
        ) {

            return [

                {
                    opcode:
                        opcodePrefix + "X",

                    blockType:
                        Scratch.BlockType.REPORTER,

                    text:
                        "[HAND] " +
                        displayName +
                        " x",

                    arguments: {
                        HAND: {
                            type:
                                Scratch.ArgumentType.STRING,

                            menu: "hands"
                        }
                    }
                },


                {
                    opcode:
                        opcodePrefix + "Y",

                    blockType:
                        Scratch.BlockType.REPORTER,

                    text:
                        "[HAND] " +
                        displayName +
                        " y",

                    arguments: {
                        HAND: {
                            type:
                                Scratch.ArgumentType.STRING,

                            menu: "hands"
                        }
                    }
                },


                {
                    opcode:
                        opcodePrefix + "Z",

                    blockType:
                        Scratch.BlockType.REPORTER,

                    text:
                        "[HAND] " +
                        displayName +
                        " z",

                    arguments: {
                        HAND: {
                            type:
                                Scratch.ArgumentType.STRING,

                            menu: "hands"
                        }
                    }
                }
            ];
        }


        /*
         * ------------------------------------------------
         * CAMERA BLOCKS
         * ------------------------------------------------
         */

        cameraAvailable() {

            return (
                this.running &&
                !!this.stream
            );
        }


        leftHandDetected() {

            return !!this.leftHand;
        }


        rightHandDetected() {

            return !!this.rightHand;
        }


        numberOfHands() {

            let count = 0;

            if (this.leftHand) {
                count++;
            }

            if (this.rightHand) {
                count++;
            }

            return count;
        }


        /*
         * ------------------------------------------------
         * WRIST
         * ------------------------------------------------
         */

        wristX(args) {
            return this.getCoordinate(
                args.HAND,
                0,
                "x"
            );
        }


        wristY(args) {
            return this.getCoordinate(
                args.HAND,
                0,
                "y"
            );
        }


        wristZ(args) {
            return this.getCoordinate(
                args.HAND,
                0,
                "z"
            );
        }


        /*
         * ------------------------------------------------
         * THUMB
         * ------------------------------------------------
         */

        thumbBottomX(args) {
            return this.getCoordinate(
                args.HAND,
                1,
                "x"
            );
        }

        thumbBottomY(args) {
            return this.getCoordinate(
                args.HAND,
                1,
                "y"
            );
        }

        thumbBottomZ(args) {
            return this.getCoordinate(
                args.HAND,
                1,
                "z"
            );
        }


        thumbMiddleX(args) {
            return this.getCoordinate(
                args.HAND,
                2,
                "x"
            );
        }

        thumbMiddleY(args) {
            return this.getCoordinate(
                args.HAND,
                2,
                "y"
            );
        }

        thumbMiddleZ(args) {
            return this.getCoordinate(
                args.HAND,
                2,
                "z"
            );
        }


        thumbTopX(args) {
            return this.getCoordinate(
                args.HAND,
                3,
                "x"
            );
        }

        thumbTopY(args) {
            return this.getCoordinate(
                args.HAND,
                3,
                "y"
            );
        }

        thumbTopZ(args) {
            return this.getCoordinate(
                args.HAND,
                3,
                "z"
            );
        }


        thumbTipX(args) {
            return this.getCoordinate(
                args.HAND,
                4,
                "x"
            );
        }

        thumbTipY(args) {
            return this.getCoordinate(
                args.HAND,
                4,
                "y"
            );
        }

        thumbTipZ(args) {
            return this.getCoordinate(
                args.HAND,
                4,
                "z"
            );
        }


        /*
         * ------------------------------------------------
         * INDEX
         * ------------------------------------------------
         */

        indexBottomX(args) {
            return this.getCoordinate(
                args.HAND,
                5,
                "x"
            );
        }

        indexBottomY(args) {
            return this.getCoordinate(
                args.HAND,
                5,
                "y"
            );
        }

        indexBottomZ(args) {
            return this.getCoordinate(
                args.HAND,
                5,
                "z"
            );
        }


        indexMiddleX(args) {
            return this.getCoordinate(
                args.HAND,
                6,
                "x"
            );
        }

        indexMiddleY(args) {
            return this.getCoordinate(
                args.HAND,
                6,
                "y"
            );
        }

        indexMiddleZ(args) {
            return this.getCoordinate(
                args.HAND,
                6,
                "z"
            );
        }


        indexTopX(args) {
            return this.getCoordinate(
                args.HAND,
                7,
                "x"
            );
        }

        indexTopY(args) {
            return this.getCoordinate(
                args.HAND,
                7,
                "y"
            );
        }

        indexTopZ(args) {
            return this.getCoordinate(
                args.HAND,
                7,
                "z"
            );
        }


        indexTipX(args) {
            return this.getCoordinate(
                args.HAND,
                8,
                "x"
            );
        }

        indexTipY(args) {
            return this.getCoordinate(
                args.HAND,
                8,
                "y"
            );
        }

        indexTipZ(args) {
            return this.getCoordinate(
                args.HAND,
                8,
                "z"
            );
        }


        /*
         * ------------------------------------------------
         * MIDDLE
         * ------------------------------------------------
         */

        middleBottomX(args) {
            return this.getCoordinate(
                args.HAND,
                9,
                "x"
            );
        }

        middleBottomY(args) {
            return this.getCoordinate(
                args.HAND,
                9,
                "y"
            );
        }

        middleBottomZ(args) {
            return this.getCoordinate(
                args.HAND,
                9,
                "z"
            );
        }


        middleMiddleX(args) {
            return this.getCoordinate(
                args.HAND,
                10,
                "x"
            );
        }

        middleMiddleY(args) {
            return this.getCoordinate(
                args.HAND,
                10,
                "y"
            );
        }

        middleMiddleZ(args) {
            return this.getCoordinate(
                args.HAND,
                10,
                "z"
            );
        }


        middleTopX(args) {
            return this.getCoordinate(
                args.HAND,
                11,
                "x"
            );
        }

        middleTopY(args) {
            return this.getCoordinate(
                args.HAND,
                11,
                "y"
            );
        }

        middleTopZ(args) {
            return this.getCoordinate(
                args.HAND,
                11,
                "z"
            );
        }


        middleTipX(args) {
            return this.getCoordinate(
                args.HAND,
                12,
                "x"
            );
        }

        middleTipY(args) {
            return this.getCoordinate(
                args.HAND,
                12,
                "y"
            );
        }

        middleTipZ(args) {
            return this.getCoordinate(
                args.HAND,
                12,
                "z"
            );
        }


        /*
         * ------------------------------------------------
         * RING
         * ------------------------------------------------
         */

        ringBottomX(args) {
            return this.getCoordinate(
                args.HAND,
                13,
                "x"
            );
        }

        ringBottomY(args) {
            return this.getCoordinate(
                args.HAND,
                13,
                "y"
            );
        }

        ringBottomZ(args) {
            return this.getCoordinate(
                args.HAND,
                13,
                "z"
            );
        }


        ringMiddleX(args) {
            return this.getCoordinate(
                args.HAND,
                14,
                "x"
            );
        }

        ringMiddleY(args) {
            return this.getCoordinate(
                args.HAND,
                14,
                "y"
            );
        }

        ringMiddleZ(args) {
            return this.getCoordinate(
                args.HAND,
                14,
                "z"
            );
        }


        ringTopX(args) {
            return this.getCoordinate(
                args.HAND,
                15,
                "x"
            );
        }

        ringTopY(args) {
            return this.getCoordinate(
                args.HAND,
                15,
                "y"
            );
        }

        ringTopZ(args) {
            return this.getCoordinate(
                args.HAND,
                15,
                "z"
            );
        }


        ringTipX(args) {
            return this.getCoordinate(
                args.HAND,
                16,
                "x"
            );
        }

        ringTipY(args) {
            return this.getCoordinate(
                args.HAND,
                16,
                "y"
            );
        }

        ringTipZ(args) {
            return this.getCoordinate(
                args.HAND,
                16,
                "z"
            );
        }


        /*
         * ------------------------------------------------
         * PINKY
         * ------------------------------------------------
         */

        pinkyBottomX(args) {
            return this.getCoordinate(
                args.HAND,
                17,
                "x"
            );
        }

        pinkyBottomY(args) {
            return this.getCoordinate(
                args.HAND,
                17,
                "y"
            );
        }

        pinkyBottomZ(args) {
            return this.getCoordinate(
                args.HAND,
                17,
                "z"
            );
        }


        pinkyMiddleX(args) {
            return this.getCoordinate(
                args.HAND,
                18,
                "x"
            );
        }

        pinkyMiddleY(args) {
            return this.getCoordinate(
                args.HAND,
                18,
                "y"
            );
        }

        pinkyMiddleZ(args) {
            return this.getCoordinate(
                args.HAND,
                18,
                "z"
            );
        }


        pinkyTopX(args) {
            return this.getCoordinate(
                args.HAND,
                19,
                "x"
            );
        }

        pinkyTopY(args) {
            return this.getCoordinate(
                args.HAND,
                19,
                "y"
            );
        }

        pinkyTopZ(args) {
            return this.getCoordinate(
                args.HAND,
                19,
                "z"
            );
        }


        pinkyTipX(args) {
            return this.getCoordinate(
                args.HAND,
                20,
                "x"
            );
        }

        pinkyTipY(args) {
            return this.getCoordinate(
                args.HAND,
                20,
                "y"
            );
        }

        pinkyTipZ(args) {
            return this.getCoordinate(
                args.HAND,
                20,
                "z"
            );
        }
    }


    Scratch.extensions.register(
        new HandTracking()
    );

})(Scratch);
