(function (Scratch) {
    "use strict";

    /*
     * Gandi Wrist Tracking Extension
     *
     * Blocks:
     *   start wrist tracking
     *   stop wrist tracking
     *   (Left/Right) wrist X
     *   (Left/Right) wrist Y
     *   (Left/Right) wrist Z
     *   (Left/Right) wrist rotation
     *   wrist tracking active?
     *
     * Coordinates:
     *   X: -240 to 240
     *   Y: -180 to 180
     *   Rotation: 0 to 360 degrees
     *   Z: 0 to 100 (closer = larger)
     */

    if (!Scratch.extensions.unsandboxed) {
        throw new Error(
            "The Wrist Tracking extension must run unsandboxed."
        );
    }

    const video = document.createElement("video");

    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    video.width = 320;
    video.height = 240;

    video.style.position = "fixed";
    video.style.left = "-10000px";
    video.style.top = "-10000px";
    video.style.width = "320px";
    video.style.height = "240px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";

    document.body.appendChild(video);

    let cameraStream = null;
    let hands = null;
    let animationFrame = null;

    let tracking = false;
    let processing = false;

    let lastProcessTime = 0;

    // Limit MediaPipe processing to approximately 30 FPS.
    const PROCESS_INTERVAL = 33;

    const wrists = {
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

    const handednessMemory = {
        Left: false,
        Right: false
    };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(
                'script[src="' + url + '"]'
            );

            if (existing) {
                if (existing.dataset.loaded === "true") {
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

            script.onload = () => {
                script.dataset.loaded = "true";
                resolve();
            };

            script.onerror = reject;

            document.head.appendChild(script);
        });
    }

    /*
     * MediaPipe's Y coordinate:
     *
     *     0 = top
     *     1 = bottom
     *
     * Gandi's Y coordinate:
     *
     *     +180 = top
     *     -180 = bottom
     *
     * Therefore:
     *
     *     Gandi Y = 180 - (MediaPipe Y * 360)
     */

    function convertX(normalizedX) {
        return clamp(
            (normalizedX - 0.5) * 480,
            -240,
            240
        );
    }

    function convertY(normalizedY) {
        return clamp(
            180 - normalizedY * 360,
            -180,
            180
        );
    }

    /*
     * MediaPipe wrist Z is not directly useful as a Scratch/Gandi
     * coordinate. We turn it into a stable 0-100 "size/closeness"
     * value.
     *
     * MediaPipe generally produces:
     *
     *     smaller Z = closer
     *     larger Z  = farther
     *
     * We invert and normalize it.
     */

    function convertZ(z) {
        /*
         * This range is intentionally fairly conservative.
         * It prevents tiny depth changes from making Z jump wildly.
         */

        const MIN_Z = -0.25;
        const MAX_Z = 0.25;

        const normalized =
            (MAX_Z - z) /
            (MAX_Z - MIN_Z);

        return clamp(
            normalized * 100,
            0,
            100
        );
    }

    /*
     * Calculate wrist rotation.
     *
     * We use:
     *
     *     index MCP = landmark 5
     *     pinky MCP = landmark 17
     *
     * The line between those points represents the orientation
     * of the hand.
     *
     * The Y axis is inverted so that the result corresponds to
     * normal Gandi/Scratch screen coordinates.
     */

    function calculateRotation(landmarks) {
        const index = landmarks[5];
        const pinky = landmarks[17];

        if (!index || !pinky) {
            return 0;
        }

        const dx = pinky.x - index.x;

        // Invert MediaPipe Y for Gandi coordinates.
        const dy = -(pinky.y - index.y);

        let angle =
            Math.atan2(dy, dx) *
            180 /
            Math.PI;

        /*
         * Convert from -180..180 to 0..360.
         */
        angle = (angle + 360) % 360;

        /*
         * Round slightly to avoid unnecessary Scratch variable
         * updates and noisy values.
         */
        return Math.round(angle * 10) / 10;
    }

    function resetDetectionFlags() {
        wrists.Left.detected = false;
        wrists.Right.detected = false;
    }

    function processResults(results) {
        resetDetectionFlags();

        if (
            !results ||
            !results.multiHandLandmarks ||
            !results.multiHandedness
        ) {
            return;
        }

        const landmarksList = results.multiHandLandmarks;
        const handednessList = results.multiHandedness;

        for (
            let i = 0;
            i < landmarksList.length;
            i++
        ) {
            const landmarks = landmarksList[i];
            const handedness = handednessList[i];

            if (!landmarks || !handedness) {
                continue;
            }

            /*
             * MediaPipe handedness is from the camera's perspective.
             *
             * Because the normal webcam image is mirrored for a
             * user-facing view, MediaPipe can report the opposite
             * physical hand depending on configuration.
             *
             * We use the handedness label supplied by MediaPipe.
             */

            let side = handedness.label;

            if (
                side !== "Left" &&
                side !== "Right"
            ) {
                continue;
            }

            const wrist = landmarks[0];

            if (!wrist) {
                continue;
            }

            const x = convertX(wrist.x);
            const y = convertY(wrist.y);
            const z = convertZ(wrist.z);

            const rotation =
                calculateRotation(landmarks);

            wrists[side].x = Math.round(x * 100) / 100;
            wrists[side].y = Math.round(y * 100) / 100;
            wrists[side].z = Math.round(z * 100) / 100;
            wrists[side].rotation = rotation;

            wrists[side].detected = true;
            handednessMemory[side] = true;
        }
    }

    async function setupMediaPipe() {
        if (hands) {
            return;
        }

        /*
         * Load MediaPipe Hands only once.
         */
        await loadScript(
            "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"
        );

        hands = new window.Hands({
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

            /*
             * Two hands maximum is all we need.
             */
            maxNumHands: 2,

            /*
             * Reasonably high tracking quality without excessive
             * CPU/RAM usage.
             */
            modelComplexity: 1,

            minDetectionConfidence: 0.65,
            minTrackingConfidence: 0.65
        });

        hands.onResults(processResults);
    }

    async function processCameraFrame() {
        if (!tracking) {
            return;
        }

        if (!hands) {
            return;
        }

        if (!video.srcObject) {
            return;
        }

        const now = performance.now();

        if (
            now - lastProcessTime <
            PROCESS_INTERVAL
        ) {
            return;
        }

        if (processing) {
            return;
        }

        if (
            video.readyState <
            HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
            return;
        }

        lastProcessTime = now;
        processing = true;

        try {
            await hands.send({
                image: video
            });
        } catch (error) {
            /*
             * Ignore occasional MediaPipe frame errors.
             * They should never crash the Gandi project.
             */
            console.warn(
                "Wrist tracking frame error:",
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

        processCameraFrame();

        animationFrame =
            requestAnimationFrame(trackingLoop);
    }

    async function startCamera() {
        if (tracking) {
            return;
        }

        try {
            await setupMediaPipe();

            cameraStream =
                await navigator.mediaDevices.getUserMedia({
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
                    },

                    audio: false
                });

            video.srcObject = cameraStream;

            await video.play();

            tracking = true;
            processing = false;
            lastProcessTime = 0;

            if (!animationFrame) {
                animationFrame =
                    requestAnimationFrame(
                        trackingLoop
                    );
            }
        } catch (error) {
            console.error(
                "Could not start wrist tracking:",
                error
            );

            tracking = false;

            if (cameraStream) {
                cameraStream
                    .getTracks()
                    .forEach(track => track.stop());

                cameraStream = null;
            }
        }
    }

    function stopCamera() {
        tracking = false;
        processing = false;

        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }

        if (cameraStream) {
            cameraStream
                .getTracks()
                .forEach(track => track.stop());

            cameraStream = null;
        }

        video.srcObject = null;

        if (hands) {
            /*
             * Do not destroy the MediaPipe object.
             *
             * Keeping it allows tracking to be restarted without
             * downloading/reinitializing the model every time.
             */
        }
    }

    class WristTrackingExtension {
        getInfo() {
            return {
                id: "gandiWristTracking",

                name: "Wrist Tracking",

                color1: "#4C97FF",
                color2: "#3373CC",
                color3: "#2E5DA8",

                blocks: [

                    {
                        opcode: "startTracking",
                        blockType: Scratch.BlockType.COMMAND,
                        text: "start wrist tracking"
                    },

                    {
                        opcode: "stopTracking",
                        blockType: Scratch.BlockType.COMMAND,
                        text: "stop wrist tracking"
                    },

                    {
                        opcode: "wristX",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "[SIDE] wrist X",
                        arguments: {
                            SIDE: {
                                type: Scratch.ArgumentType.STRING,
                                menu: "sides",
                                defaultValue: "Left"
                            }
                        }
                    },

                    {
                        opcode: "wristY",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "[SIDE] wrist Y",
                        arguments: {
                            SIDE: {
                                type: Scratch.ArgumentType.STRING,
                                menu: "sides",
                                defaultValue: "Left"
                            }
                        }
                    },

                    {
                        opcode: "wristZ",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "[SIDE] wrist Z",
                        arguments: {
                            SIDE: {
                                type: Scratch.ArgumentType.STRING,
                                menu: "sides",
                                defaultValue: "Left"
                            }
                        }
                    },

                    {
                        opcode: "wristRotation",
                        blockType: Scratch.BlockType.REPORTER,
                        text: "[SIDE] wrist rotation",
                        arguments: {
                            SIDE: {
                                type: Scratch.ArgumentType.STRING,
                                menu: "sides",
                                defaultValue: "Left"
                            }
                        }
                    },

                    {
                        opcode: "trackingActive",
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: "wrist tracking active?"
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
                args.SIDE === "Right"
                    ? "Right"
                    : "Left";

            return wrists[side].x;
        }

        wristY(args) {
            const side =
                args.SIDE === "Right"
                    ? "Right"
                    : "Left";

            return wrists[side].y;
        }

        wristZ(args) {
            const side =
                args.SIDE === "Right"
                    ? "Right"
                    : "Left";

            return wrists[side].z;
        }

        wristRotation(args) {
            const side =
                args.SIDE === "Right"
                    ? "Right"
                    : "Left";

            return wrists[side].rotation;
        }

        trackingActive() {
            return tracking;
        }
    }

    Scratch.extensions.register(
        new WristTrackingExtension()
    );

})(Scratch);
