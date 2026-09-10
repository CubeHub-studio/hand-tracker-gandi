(function (Scratch) {
    "use strict";

    /*
     * Gandi Hand Tracking
     * MediaPipe Tasks Vision Hand Landmarker
     *
     * Requires camera permission.
     */

    const extensionId = "gandiHandTracking";

    // MediaPipe CDN
    const MEDIAPIPE_CDN =
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";

    const WASM_ROOT =
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm";

    const MODEL_URL =
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

    class HandTracking {
        constructor() {
            this.video = null;
            this.canvas = null;
            this.ctx = null;

            this.handLandmarker = null;
            this.running = false;
            this.initializing = false;

            this.results = null;

            this.leftHand = null;
            this.rightHand = null;

            this.lastVideoTime = -1;

            this._setupElements();
            this._loadMediaPipe();
        }

        _setupElements() {
            this.video = document.createElement("video");

            this.video.setAttribute("autoplay", "");
            this.video.setAttribute("playsinline", "");
            this.video.muted = true;

            // Keep the video hidden.
            this.video.style.position = "fixed";
            this.video.style.left = "-10000px";
            this.video.style.top = "-10000px";
            this.video.style.width = "640px";
            this.video.style.height = "480px";
            this.video.style.opacity = "0";
            this.video.style.pointerEvents = "none";

            document.body.appendChild(this.video);

            this.canvas = document.createElement("canvas");
            this.canvas.width = 640;
            this.canvas.height = 480;

            this.ctx = this.canvas.getContext("2d", {
                willReadFrequently: true
            });
        }

        async _loadMediaPipe() {
            if (this.initializing || this.handLandmarker) {
                return;
            }

            this.initializing = true;

            try {
                const module = await import(MEDIAPIPE_CDN);

                const {
                    FilesetResolver,
                    HandLandmarker
                } = module;

                const vision = await FilesetResolver.forVisionTasks(
                    WASM_ROOT
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

                console.log(
                    "[Gandi Hand Tracking] MediaPipe loaded."
                );

                await this.requestCamera();

            } catch (error) {
                console.error(
                    "[Gandi Hand Tracking] Failed to load MediaPipe:",
                    error
                );
            }

            this.initializing = false;
        }

        async requestCamera() {
            if (!navigator.mediaDevices ||
                !navigator.mediaDevices.getUserMedia) {

                console.error(
                    "[Gandi Hand Tracking] Camera API is unavailable."
                );

                return;
            }

            try {
                /*
                 * This explicitly requests camera permission.
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

                            facingMode: "user"
                        },

                        audio: false
                    });

                this.video.srcObject = stream;

                await this.video.play();

                this.running = true;

                this._processFrame();

                console.log(
                    "[Gandi Hand Tracking] Camera started."
                );

            } catch (error) {
                console.error(
                    "[Gandi Hand Tracking] Camera permission denied or unavailable:",
                    error
                );
            }
        }

        async _processFrame() {
            if (!this.running) {
                return;
            }

            if (!this.handLandmarker) {
                requestAnimationFrame(() => {
                    this._processFrame();
                });

                return;
            }

            if (
                this.video.readyState >= 2 &&
                this.video.currentTime !== this.lastVideoTime
            ) {
                this.lastVideoTime = this.video.currentTime;

                try {
                    this.results =
                        this.handLandmarker.detectForVideo(
                            this.video,
                            performance.now()
                        );

                    this._updateHands();

                } catch (error) {
                    console.error(
                        "[Gandi Hand Tracking] Detection error:",
                        error
                    );
                }
            }

            requestAnimationFrame(() => {
                this._processFrame();
            });
        }

        _updateHands() {
            this.leftHand = null;
            this.rightHand = null;

            if (!this.results) {
                return;
            }

            const landmarks =
                this.results.landmarks || [];

            const handedness =
                this.results.handedness || [];

            for (let i = 0; i < landmarks.length; i++) {
                const hand = landmarks[i];

                const classification =
                    handedness[i] &&
                    handedness[i][0];

                if (!classification) {
                    continue;
                }

                /*
                 * MediaPipe's handedness is based on the
                 * mirrored/selfie image convention.
                 *
                 * The handedness label is what we expose
                 * to Gandi.
                 */
                if (classification.categoryName === "Left") {
                    this.leftHand = hand;
                } else if (
                    classification.categoryName === "Right"
                ) {
                    this.rightHand = hand;
                }
            }
        }

        _getHand(handName) {
            const name =
                String(handName || "left").toLowerCase();

            if (name === "right") {
                return this.rightHand;
            }

            return this.leftHand;
        }

        _getLandmark(handName, index) {
            const hand = this._getHand(handName);

            if (!hand || !hand[index]) {
                return null;
            }

            return hand[index];
        }

        _getFinger(handName, startIndex) {
            const hand = this._getHand(handName);

            if (!hand) {
                return [];
            }

            return hand.slice(
                startIndex,
                startIndex + 4
            );
        }

        _coordinates(handName, indexes, axis) {
            const hand = this._getHand(handName);

            if (!hand) {
                return [];
            }

            return indexes.map(index => {
                if (!hand[index]) {
                    return 0;
                }

                return Number(
                    hand[index][axis]
                );
            });
        }

        _fingerCoordinates(
            handName,
            startIndex,
            axis
        ) {
            return this._coordinates(
                handName,
                [
                    startIndex,
                    startIndex + 1,
                    startIndex + 2,
                    startIndex + 3
                ],
                axis
            );
        }

        getInfo() {
            return {
                id: extensionId,
                name: "Hand Tracking",
                color1: "#5B5BFF",
                color2: "#4545D8",
                color3: "#3030A8"
            };
        }

        getBlocks() {
            return [

                {
                    opcode: "cameraStatus",
                    blockType: Scratch.BlockType.BOOLEAN,
                    text: "camera available?"
                },

                {
                    opcode: "handDetected",
                    blockType: Scratch.BlockType.BOOLEAN,
                    text: "[HAND] hand detected?",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "numberOfHands",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "number of hands"
                },

                /*
                 * WHOLE HAND X/Y/Z
                 */

                {
                    opcode: "handX",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] hand x",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "handY",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] hand y",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "handZ",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] hand z",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                /*
                 * THUMB
                 */

                {
                    opcode: "thumbX",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] thumb x",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbY",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] thumb y",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "thumbZ",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] thumb z",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                /*
                 * INDEX
                 */

                {
                    opcode: "indexFingerX",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] index finger x",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexFingerY",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] index finger y",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "indexFingerZ",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] index finger z",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                /*
                 * MIDDLE
                 */

                {
                    opcode: "middleFingerX",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] middle finger x",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleFingerY",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] middle finger y",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "middleFingerZ",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] middle finger z",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                /*
                 * RING
                 */

                {
                    opcode: "ringFingerX",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] ring finger x",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringFingerY",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] ring finger y",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "ringFingerZ",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] ring finger z",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                /*
                 * PINKY
                 */

                {
                    opcode: "pinkyFingerX",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] pinky x",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyFingerY",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] pinky y",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "pinkyFingerZ",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] pinky z",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                /*
                 * ALL 21 LANDMARKS
                 */

                {
                    opcode: "allX",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] all hand x",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "allY",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] all hand y",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                {
                    opcode: "allZ",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] all hand z",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        }
                    }
                },

                /*
                 * LANDMARK BY NAME
                 */

                {
                    opcode: "landmarkX",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] [LANDMARK] x",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        },

                        LANDMARK: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "landmarks"
                        }
                    }
                },

                {
                    opcode: "landmarkY",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] [LANDMARK] y",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        },

                        LANDMARK: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "landmarks"
                        }
                    }
                },

                {
                    opcode: "landmarkZ",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "[HAND] [LANDMARK] z",
                    arguments: {
                        HAND: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "hands"
                        },

                        LANDMARK: {
                            type: Scratch.ArgumentType.STRING,
                            menu: "landmarks"
                        }
                    }
                }
            ];
        }

        getMenus() {
            return {
                hands: {
                    acceptReporters: true,
                    items: [
                        "left",
                        "right"
                    ]
                },

                landmarks: {
                    acceptReporters: true,
                    items: [
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
                    ]
                }
            };
        }

        cameraStatus() {
            return !!(
                this.video &&
                this.video.srcObject
            );
        }

        handDetected(args) {
            return !!this._getHand(args.HAND);
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
         * Calculate center of all 21 landmarks.
         */
        _handCenter(handName, axis) {
            const hand = this._getHand(handName);

            if (!hand || hand.length === 0) {
                return [];
            }

            return hand.map(point => {
                return Number(point[axis]);
            });
        }

        handX(args) {
            return this._handCenter(args.HAND, "x");
        }

        handY(args) {
            return this._handCenter(args.HAND, "y");
        }

        handZ(args) {
            return this._handCenter(args.HAND, "z");
        }

        thumbX(args) {
            return this._fingerCoordinates(
                args.HAND,
                1,
                "x"
            );
        }

        thumbY(args) {
            return this._fingerCoordinates(
                args.HAND,
                1,
                "y"
            );
        }

        thumbZ(args) {
            return this._fingerCoordinates(
                args.HAND,
                1,
                "z"
            );
        }

        indexFingerX(args) {
            return this._fingerCoordinates(
                args.HAND,
                5,
                "x"
            );
        }

        indexFingerY(args) {
            return this._fingerCoordinates(
                args.HAND,
                5,
                "y"
            );
        }

        indexFingerZ(args) {
            return this._fingerCoordinates(
                args.HAND,
                5,
                "z"
            );
        }

        middleFingerX(args) {
            return this._fingerCoordinates(
                args.HAND,
                9,
                "x"
            );
        }

        middleFingerY(args) {
            return this._fingerCoordinates(
                args.HAND,
                9,
                "y"
            );
        }

        middleFingerZ(args) {
            return this._fingerCoordinates(
                args.HAND,
                9,
                "z"
            );
        }

        ringFingerX(args) {
            return this._fingerCoordinates(
                args.HAND,
                13,
                "x"
            );
        }

        ringFingerY(args) {
            return this._fingerCoordinates(
                args.HAND,
                13,
                "y"
            );
        }

        ringFingerZ(args) {
            return this._fingerCoordinates(
                args.HAND,
                13,
                "z"
            );
        }

        pinkyFingerX(args) {
            return this._fingerCoordinates(
                args.HAND,
                17,
                "x"
            );
        }

        pinkyFingerY(args) {
            return this._fingerCoordinates(
                args.HAND,
                17,
                "y"
            );
        }

        pinkyFingerZ(args) {
            return this._fingerCoordinates(
                args.HAND,
                17,
                "z"
            );
        }

        allX(args) {
            return this._coordinates(
                args.HAND,
                Array.from(
                    { length: 21 },
                    (_, i) => i
                ),
                "x"
            );
        }

        allY(args) {
            return this._coordinates(
                args.HAND,
                Array.from(
                    { length: 21 },
                    (_, i) => i
                ),
                "y"
            );
        }

        allZ(args) {
            return this._coordinates(
                args.HAND,
                Array.from(
                    { length: 21 },
                    (_, i) => i
                ),
                "z"
            );
        }

        _landmarkIndex(name) {
            const indexes = {
                "wrist": 0,

                "thumb bottom joint": 1,
                "thumb middle joint": 2,
                "thumb top joint": 3,
                "thumb tip": 4,

                "index bottom joint": 5,
                "index middle joint": 6,
                "index top joint": 7,
                "index tip": 8,

                "middle bottom joint": 9,
                "middle middle joint": 10,
                "middle top joint": 11,
                "middle tip": 12,

                "ring bottom joint": 13,
                "ring middle joint": 14,
                "ring top joint": 15,
                "ring tip": 16,

                "pinky bottom joint": 17,
                "pinky middle joint": 18,
                "pinky top joint": 19,
                "pinky tip": 20
            };

            return indexes[name];
        }

        landmarkX(args) {
            const index =
                this._landmarkIndex(args.LANDMARK);

            const point =
                this._getLandmark(
                    args.HAND,
                    index
                );

            return point ? Number(point.x) : 0;
        }

        landmarkY(args) {
            const index =
                this._landmarkIndex(args.LANDMARK);

            const point =
                this._getLandmark(
                    args.HAND,
                    index
                );

            return point ? Number(point.y) : 0;
        }

        landmarkZ(args) {
            const index =
                this._landmarkIndex(args.LANDMARK);

            const point =
                this._getLandmark(
                    args.HAND,
                    index
                );

            return point ? Number(point.z) : 0;
        }
    }

    Scratch.extensions.register(
        new HandTracking()
    );

})(Scratch);
