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

        this.results = null;

        this.frameRequest = null;
        this.lastProcessedTime = -1;

        this.mediaPipeLoaded = false;
    }

    // =========================================================
    // LOAD MEDIAPIPE USING SCRIPT TAGS
    // =========================================================

    loadScript(url) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(
                `script[src="${url}"]`
            );

            if (existing) {
                if (existing.dataset.loaded === "true") {
                    resolve();
                    return;
                }

                existing.addEventListener("load", () => {
                    resolve();
                });

                existing.addEventListener("error", () => {
                    reject(
                        new Error(
                            "Failed to load MediaPipe script: " + url
                        )
                    );
                });

                return;
            }

            const script = document.createElement("script");

            script.src = url;
            script.async = true;
            script.crossOrigin = "anonymous";

            script.onload = () => {
                script.dataset.loaded = "true";
                resolve();
            };

            script.onerror = () => {
                reject(
                    new Error(
                        "Failed to load MediaPipe script: " + url
                    )
                );
            };

            document.head.appendChild(script);
        });
    }

    async loadMediaPipe() {
        if (this.mediaPipeLoaded && window.Hands) {
            return;
        }

        if (this.loading) {
            while (this.loading) {
                await new Promise(resolve =>
                    setTimeout(resolve, 50)
                );
            }

            if (this.mediaPipeLoaded && window.Hands) {
                return;
            }
        }

        this.loading = true;

        try {
            /*
             * Classic MediaPipe Hands browser library.
             *
             * No ES module.
             * No dynamic import().
             */
            await this.loadScript(
                "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js"
            );

            if (!window.Hands) {
                throw new Error(
                    "MediaPipe Hands loaded, but the Hands API was not found."
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

                modelComplexity: 1,

                minDetectionConfidence: 0.5,

                minTrackingConfidence: 0.5
            });

            this.hands.onResults(results => {
                this.results = results;
            });

            this.mediaPipeLoaded = true;

        } catch (error) {
            console.error(
                "Hand Tracking: MediaPipe failed to load.",
                error
            );

            throw error;

        } finally {
            this.loading = false;
        }
    }

    // =========================================================
    // CAMERA
    // =========================================================

    async startHandTracking() {
        if (this.running) {
            return;
        }

        try {
            /*
             * Ask for the camera first.
             */
            if (!navigator.mediaDevices) {
                throw new Error(
                    "navigator.mediaDevices is unavailable."
                );
            }

            if (!navigator.mediaDevices.getUserMedia) {
                throw new Error(
                    "getUserMedia is unavailable in this browser."
                );
            }

            if (!this.stream) {
                this.stream =
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

                this.video.srcObject = this.stream;

                await this.video.play();
            }

            /*
             * Load MediaPipe after the user starts tracking.
             */
            await this.loadMediaPipe();

            this.running = true;

            this.lastProcessedTime = -1;

            this.processFrame();

        } catch (error) {
            console.error(
                "Hand Tracking could not start:",
                error
            );

            this.running = false;

            if (this.stream) {
                for (const track of this.stream.getTracks()) {
                    track.stop();
                }
            }

            this.stream = null;

            this.video.srcObject = null;

            throw error;
        }
    }

    stopHandTracking() {
        this.running = false;

        if (this.frameRequest !== null) {
            cancelAnimationFrame(
                this.frameRequest
            );

            this.frameRequest = null;
        }

        if (this.stream) {
            for (const track of this.stream.getTracks()) {
                track.stop();
            }
        }

        this.stream = null;

        this.video.srcObject = null;

        this.results = null;

        this.lastProcessedTime = -1;
    }

    // =========================================================
    // FRAME PROCESSING
    // =========================================================

    processFrame() {
        if (!this.running) {
            return;
        }

        if (
            this.hands &&
            this.video.readyState >= 2 &&
            this.video.videoWidth > 0 &&
            this.video.videoHeight > 0
        ) {
            const currentTime =
                this.video.currentTime;

            /*
             * Don't process the same video frame twice.
             */
            if (
                currentTime !==
                this.lastProcessedTime
            ) {
                this.lastProcessedTime =
                    currentTime;

                this.hands.send({
                    image: this.video
                }).catch(error => {
                    console.error(
                        "MediaPipe frame error:",
                        error
                    );
                });
            }
        }

        this.frameRequest =
            requestAnimationFrame(
                () => this.processFrame()
            );
    }

    // =========================================================
    // GENERAL HAND INFORMATION
    // =========================================================

    cameraActive() {
        return this.running;
    }

    getNumberOfHands() {
        if (!this.results) {
            return 0;
        }

        if (!this.results.multiHandLandmarks) {
            return 0;
        }

        return this.results.multiHandLandmarks.length;
    }

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
            const detected =
                this.results.multiHandedness[i];

            if (!detected) {
                continue;
            }

            let label = "";

            if (detected.label) {
                label =
                    String(
                        detected.label
                    ).toLowerCase();
            } else if (
                detected.classification &&
                detected.classification.length > 0
            ) {
                label =
                    String(
                        detected.classification[0].label
                    ).toLowerCase();
            }

            if (label === wanted) {
                return i;
            }
        }

        return -1;
    }

    handDetected(args) {
        return (
            this.getHandIndex(
                args.HAND
            ) !== -1
        );
    }

    // =========================================================
    // LANDMARK ACCESS
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

        if (!landmarks[index]) {
            return null;
        }

        return landmarks[index];
    }

    getX(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        if (!landmark) {
            return 0;
        }

        return landmark.x;
    }

    getY(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        if (!landmark) {
            return 0;
        }

        return landmark.y;
    }

    getZ(hand, index) {
        const landmark =
            this.getLandmark(
                hand,
                index
            );

        if (!landmark) {
            return 0;
        }

        return landmark.z;
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
    // BLOCK GENERATION
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
            ["wrist", "Wrist", 0],

            ["thumbBottom", "Thumb Bottom Joint", 1],
            ["thumbMiddle", "Thumb Middle Joint", 2],
            ["thumbTop", "Thumb Top Joint", 3],
            ["thumbTip", "Thumb Tip", 4],

            ["indexBottom", "Index Bottom Joint", 5],
            ["indexMiddle", "Index Middle Joint", 6],
            ["indexTop", "Index Top Joint", 7],
            ["indexTip", "Index Tip", 8],

            ["middleBottom", "Middle Bottom Joint", 9],
            ["middleMiddle", "Middle Middle Joint", 10],
            ["middleTop", "Middle Top Joint", 11],
            ["middleTip", "Middle Tip", 12],

            ["ringBottom", "Ring Bottom Joint", 13],
            ["ringMiddle", "Ring Middle Joint", 14],
            ["ringTop", "Ring Top Joint", 15],
            ["ringTip", "Ring Tip", 16],

            ["pinkyBottom", "Pinky Bottom Joint", 17],
            ["pinkyMiddle", "Pinky Middle Joint", 18],
            ["pinkyTop", "Pinky Top Joint", 19],
            ["pinkyTip", "Pinky Tip", 20]
        ];

        for (const landmark of landmarks) {
            const name = landmark[0];
            const displayName = landmark[1];

            blocks.push({
                opcode: name + "X",
                blockType: "reporter",
                text: "[HAND] " + displayName.toLowerCase() + " x",

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
                text: "[HAND] " + displayName.toLowerCase() + " y",

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
                text: "[HAND] " + displayName.toLowerCase() + " z",

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
// UNSANDBOXED REQUIREMENT
// =============================================================

if (!Scratch.extensions.unsandboxed) {
    throw new Error(
        "The Hand Tracking extension must run unsandboxed."
    );
}


// =============================================================
// REGISTER EXTENSION
// =============================================================

Scratch.extensions.register(
    new HandTrackingExtension()
);
