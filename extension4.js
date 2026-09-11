(function (Scratch) {
    "use strict";

    if (!Scratch.extensions.unsandboxed) {
        throw new Error("Wrist Tracking requires an unsandboxed extension.");
    }

    const EXT_ID = "gandiWristTracking";

    let video = null;
    let stream = null;
    let hands = null;

    let tracking = false;
    let loading = false;
    let processing = false;

    let animationFrame = null;
    let lastFrameTime = 0;

    const FPS_INTERVAL = 33;

    const wristData = {
        Left: {
            x: 0,
            y: 0,
            z: 0,
            rotation: 0,
            detected: false
        },

        Right: {
            x: 0,
            y: 0,
            z: 0,
            rotation: 0,
            detected: false
        }
    };

    /*
     * ---------------------------------------------------------
     * Utility
     * ---------------------------------------------------------
     */

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function round(value, decimals) {
        const multiplier = Math.pow(10, decimals);
        return Math.round(value * multiplier) / multiplier;
    }

    /*
     * ---------------------------------------------------------
     * Gandi / Scratch coordinates
     *
     * MediaPipe:
     *   X = 0 left -> 1 right
     *   Y = 0 top  -> 1 bottom
     *
     * Gandi:
     *   X = -240 -> 240
     *   Y = -180 -> 180
     * ---------------------------------------------------------
     */

    function gandiX(x) {
        return clamp(
            (x - 0.5) * 480,
            -240,
            240
        );
    }

    function gandiY(y) {
        return clamp(
            180 - (y * 360),
            -180,
            180
        );
    }

    /*
     * ---------------------------------------------------------
     * Z
     *
     * Z is NOT returned as raw MediaPipe depth.
     *
     * It becomes:
     *
     *   0   = far
     *   100 = close
     *
     * This is intended to be useful as a sprite size value.
     * ---------------------------------------------------------
     */

    function gandiZ(z) {
        const FAR = 0.30;
        const CLOSE = -0.25;

        let value =
            (FAR - z) /
            (FAR - CLOSE);

        value = clamp(value, 0, 1);

        return round(value * 100, 2);
    }

    /*
     * ---------------------------------------------------------
     * Wrist rotation
     *
     * Uses index MCP (5) and pinky MCP (17).
     *
     * The result is:
     *
     *   0 -> 360 degrees
     *
     * in screen/Gandi orientation.
     * ---------------------------------------------------------
     */

    function calculateRotation(landmarks) {
        const index = landmarks[5];
        const pinky = landmarks[17];

        if (!index || !pinky) {
            return 0;
        }

        const dx = pinky.x - index.x;

        // Flip MediaPipe Y to match Gandi's Y direction.
        const dy = -(pinky.y - index.y);

        let angle =
            Math.atan2(dy, dx) *
            180 /
            Math.PI;

        angle = (angle + 360) % 360;

        return round(angle, 1);
    }

    /*
     * ---------------------------------------------------------
     * MediaPipe result handler
     * ---------------------------------------------------------
     */

    function handleResults(results) {
        wristData.Left.detected = false;
        wristData.Right.detected = false;

        if (!results) {
            return;
        }

        const landmarkSets =
            results.multiHandLandmarks || [];

        const handedness =
            results.multiHandedness || [];

        for (let i = 0; i < landmarkSets.length; i++) {
            const landmarks = landmarkSets[i];

            if (!landmarks || landmarks.length < 18) {
                continue;
            }

            let side = null;

            if (handedness[i]) {
                side = handedness[i].label;
            }

            if (side !== "Left" && side !== "Right") {
                continue;
            }

            const wrist = landmarks[0];

            if (!wrist) {
                continue;
            }

            const x = gandiX(wrist.x);
            const y = gandiY(wrist.y);
            const z = gandiZ(wrist.z);
            const rotation =
                calculateRotation(landmarks);

            /*
             * Smooth values slightly.
             *
             * This prevents the wrist from jumping around
             * from frame to frame.
             */

            const old = wristData[side];

            const SMOOTHING = 0.35;

            old.x =
                old.x +
                (x - old.x) *
                SMOOTHING;

            old.y =
                old.y +
                (y - old.y) *
                SMOOTHING;

            old.z =
                old.z +
                (z - old.z) *
                SMOOTHING;

            /*
             * Rotation is circular, so calculate the shortest
             * angular difference instead of directly averaging.
             */

            let difference =
                rotation -
                old.rotation;

            while (difference > 180) {
                difference -= 360;
            }

            while (difference < -180) {
                difference += 360;
            }

            old.rotation =
                (old.rotation +
                    difference * SMOOTHING +
                    360) % 360;

            old.x = round(old.x, 2);
            old.y = round(old.y, 2);
            old.z = round(old.z, 2);
            old.rotation = round(old.rotation, 1);

            old.detected = true;
        }
    }

    /*
     * ---------------------------------------------------------
     * Load MediaPipe
     *
     * We explicitly wait for the script to finish loading.
     * ---------------------------------------------------------
     */

    function loadMediaPipe() {
        return new Promise((resolve, reject) => {
            if (
                window.Hands &&
                typeof window.Hands === "function"
            ) {
                resolve();
                return;
            }

            const oldScript =
                document.getElementById(
                    "gandi-mediapipe-hands"
                );

            if (oldScript) {
                oldScript.addEventListener(
                    "load",
                    () => resolve(),
                    { once: true }
                );

                oldScript.addEventListener(
                    "error",
                    () => reject(
                        new Error(
                            "MediaPipe Hands failed to load."
                        )
                    ),
                    { once: true }
                );

                return;
            }

            const script =
                document.createElement("script");

            script.id =
                "gandi-mediapipe-hands";

            script.src =
                "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";

            script.async = true;

            script.onload = () => {
                if (
                    window.Hands &&
                    typeof window.Hands === "function"
                ) {
                    resolve();
                } else {
                    reject(
                        new Error(
                            "MediaPipe loaded but Hands was unavailable."
                        )
                    );
                }
            };

            script.onerror = () => {
                reject(
                    new Error(
                        "Could not download MediaPipe Hands."
                    )
                );
            };

            document.head.appendChild(script);
        });
    }

    /*
     * ---------------------------------------------------------
     * Create video element
     * ---------------------------------------------------------
     */

    function createVideo() {
        if (video) {
            return;
        }

        video =
            document.createElement("video");

        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;

        video.width = 320;
        video.height = 240;

        /*
         * Keep the camera preview visible.
         *
         * This is intentional so the user can immediately
         * tell whether tracking actually started.
         */

        video.style.position = "fixed";
        video.style.right = "15px";
        video.style.bottom = "15px";

        video.style.width = "320px";
        video.style.height = "240px";

        video.style.objectFit = "cover";

        video.style.zIndex = "999999";

        video.style.borderRadius = "10px";

        video.style.background =
            "black";

        video.style.boxShadow =
            "0 4px 20px rgba(0,0,0,0.5)";

        document.body.appendChild(video);
    }

    /*
     * ---------------------------------------------------------
     * Create MediaPipe Hands
     * ---------------------------------------------------------
     */

    function createHands() {
        if (hands) {
            return;
        }

        hands =
            new window.Hands({
                locateFile: function (file) {
                    return (
                        "https://cdn.jsdelivr.net/npm/" +
                        "@mediapipe/hands/" +
                        file
                    );
                }
            });

        hands.setOptions({
            selfieMode: true,

            maxNumHands: 2,

            modelComplexity: 1,

            minDetectionConfidence: 0.60,

            minTrackingConfidence: 0.60
        });

        hands.onResults(handleResults);
    }

    /*
     * ---------------------------------------------------------
     * Camera
     * ---------------------------------------------------------
     */

    async function startCamera() {
        if (tracking || loading) {
            return;
        }

        loading = true;

        try {
            /*
             * Create everything before asking for the camera.
             */

            createVideo();

            await loadMediaPipe();

            createHands();

            /*
             * Ask the browser for the webcam.
             */

            stream =
                await navigator.mediaDevices.getUserMedia({
                    audio: false,

                    video: {
                        width: {
                            ideal: 320
                        },

                        height: {
                            ideal: 240
                        },

                        frameRate: {
                            ideal: 30,

                            max: 30
                        },

                        facingMode: "user"
                    }
                });

            video.srcObject = stream;

            /*
             * Explicitly wait for video metadata.
             */

            await new Promise((resolve) => {
                if (video.readyState >= 2) {
                    resolve();
                    return;
                }

                video.onloadeddata = () => {
                    resolve();
                };
            });

            await video.play();

            tracking = true;

            loading = false;

            lastFrameTime = 0;

            /*
             * Make sure only one loop exists.
             */

            if (!animationFrame) {
                animationFrame =
                    requestAnimationFrame(
                        trackingLoop
                    );
            }

        } catch (error) {
            loading = false;
            tracking = false;

            console.error(
                "[Wrist Tracking]",
                error
            );

            if (stream) {
                stream
                    .getTracks()
                    .forEach(track => track.stop());

                stream = null;
            }

            if (video) {
                video.srcObject = null;
            }

            /*
             * Show the error visibly instead of silently doing
             * nothing.
             */

            alert(
                "Wrist Tracking could not start.\n\n" +
                error.message
            );
        }
    }

    /*
     * ---------------------------------------------------------
     * Frame loop
     * ---------------------------------------------------------
     */

    async function processFrame() {
        if (!tracking) {
            return;
        }

        if (!hands) {
            return;
        }

        if (!video) {
            return;
        }

        if (
            video.readyState <
            HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
            return;
        }

        if (processing) {
            return;
        }

        const now =
            performance.now();

        if (
            now - lastFrameTime <
            FPS_INTERVAL
        ) {
            return;
        }

        lastFrameTime = now;

        processing = true;

        try {
            await hands.send({
                image: video
            });
        } catch (error) {
            console.warn(
                "[Wrist Tracking] Frame error:",
                error
            );
        }

        processing = false;
    }

    function trackingLoop() {
        if (!tracking) {
            animationFrame = null;
            return;
        }

        processFrame();

        animationFrame =
            requestAnimationFrame(
                trackingLoop
            );
    }

    /*
     * ---------------------------------------------------------
     * Stop
     * ---------------------------------------------------------
     */

    function stopCamera() {
        tracking = false;
        loading = false;
        processing = false;

        if (animationFrame) {
            cancelAnimationFrame(
                animationFrame
            );

            animationFrame = null;
        }

        if (stream) {
            stream
                .getTracks()
                .forEach(track => track.stop());

            stream = null;
        }

        if (video) {
            video.pause();
            video.srcObject = null;

            video.remove();

            video = null;
        }
    }

    /*
     * ---------------------------------------------------------
     * Extension
     * ---------------------------------------------------------
     */

    class WristTracking {
        getInfo() {
            return {
                id: EXT_ID,

                name: "Wrist Tracking",

                color1: "#4C97FF",
                color2: "#3373CC",
                color3: "#2E5DA8",

                blocks: [
                    {
                        opcode: "startTracking",

                        blockType:
                            Scratch.BlockType.COMMAND,

                        text:
                            "start wrist tracking"
                    },

                    {
                        opcode: "stopTracking",

                        blockType:
                            Scratch.BlockType.COMMAND,

                        text:
                            "stop wrist tracking"
                    },

                    {
                        opcode: "wristX",

                        blockType:
                            Scratch.BlockType.REPORTER,

                        text:
                            "[SIDE] wrist X",

                        arguments: {
                            SIDE: {
                                type:
                                    Scratch.ArgumentType.STRING,

                                menu:
                                    "sides",

                                defaultValue:
                                    "Left"
                            }
                        }
                    },

                    {
                        opcode: "wristY",

                        blockType:
                            Scratch.BlockType.REPORTER,

                        text:
                            "[SIDE] wrist Y",

                        arguments: {
                            SIDE: {
                                type:
                                    Scratch.ArgumentType.STRING,

                                menu:
                                    "sides",

                                defaultValue:
                                    "Left"
                            }
                        }
                    },

                    {
                        opcode: "wristZ",

                        blockType:
                            Scratch.BlockType.REPORTER,

                        text:
                            "[SIDE] wrist Z",

                        arguments: {
                            SIDE: {
                                type:
                                    Scratch.ArgumentType.STRING,

                                menu:
                                    "sides",

                                defaultValue:
                                    "Left"
                            }
                        }
                    },

                    {
                        opcode: "wristRotation",

                        blockType:
                            Scratch.BlockType.REPORTER,

                        text:
                            "[SIDE] wrist rotation",

                        arguments: {
                            SIDE: {
                                type:
                                    Scratch.ArgumentType.STRING,

                                menu:
                                    "sides",

                                defaultValue:
                                    "Left"
                            }
                        }
                    },

                    {
                        opcode: "trackingActive",

                        blockType:
                            Scratch.BlockType.BOOLEAN,

                        text:
                            "wrist tracking active?"
                    }
                ],

                menus: {
                    sides: {
                        acceptReporters: true,

                        items: [
                            "Left",
                            "Right"
                        ]
                    }
                }
            };
        }

        startTracking() {
            startCamera();
        }

        stopTracking() {
            stopCamera();
        }

        wristX(args) {
            const side =
                String(args.SIDE) === "Right"
                    ? "Right"
                    : "Left";

            return wristData[side].x;
        }

        wristY(args) {
            const side =
                String(args.SIDE) === "Right"
                    ? "Right"
                    : "Left";

            return wristData[side].y;
        }

        wristZ(args) {
            const side =
                String(args.SIDE) === "Right"
                    ? "Right"
                    : "Left";

            return wristData[side].z;
        }

        wristRotation(args) {
            const side =
                String(args.SIDE) === "Right"
                    ? "Right"
                    : "Left";

            return wristData[side].rotation;
        }

        trackingActive() {
            return tracking;
        }
    }

    Scratch.extensions.register(
        new WristTracking()
    );

})(Scratch);
