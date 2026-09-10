class MediaPipeToGandi {
    getInfo() {
        return {
            id: "mediapipetogandi",
            name: "MediaPipe → Gandi",

            color1: "#5B5BFF",
            color2: "#4747CC",
            color3: "#333399",

            blocks: [
                {
                    opcode: "translate",
                    blockType: "reporter",
                    text: "translate MediaPipe [VALUE] as [AXIS] to Gandi",

                    arguments: {
                        VALUE: {
                            type: "number",
                            defaultValue: "0.5"
                        },

                        AXIS: {
                            type: "string",
                            menu: "axes"
                        }
                    }
                }
            ],

            menus: {
                axes: {
                    acceptReporters: true,

                    items: [
                        {
                            text: "X",
                            value: "X"
                        },

                        {
                            text: "Y",
                            value: "Y"
                        },

                        {
                            text: "Z",
                            value: "Z"
                        }
                    ]
                }
            }
        };
    }

    translate(args) {
        const value = Number(args.VALUE);
        const axis = String(args.AXIS).toUpperCase();

        if (!Number.isFinite(value)) {
            return 0;
        }

        // ============================================
        // MEDIAPIPE X → GANDI X
        //
        // MediaPipe:
        // 0.0 = left
        // 0.5 = center
        // 1.0 = right
        //
        // Gandi:
        // -240 = left
        //    0 = center
        //  240 = right
        // ============================================

        if (axis === "X") {
            return (value - 0.5) * 480;
        }

        // ============================================
        // MEDIAPIPE Y → GANDI Y
        //
        // MediaPipe:
        // 0.0 = top
        // 0.5 = center
        // 1.0 = bottom
        //
        // Gandi:
        // 180 = top
        //   0 = center
        // -180 = bottom
        // ============================================

        if (axis === "Y") {
            return 180 - (value * 360);
        }

        // ============================================
        // MEDIAPIPE Z → GANDI Z
        //
        // MediaPipe Z is relative depth.
        // Scale it by 480 to give it a useful
        // coordinate-like range.
        // ============================================

        if (axis === "Z") {
            return value * 480;
        }

        return 0;
    }
}


// ========================================================
// GANDI / SCRATCH UNSANDBOXED REQUIREMENT
// ========================================================

if (!Scratch.extensions.unsandboxed) {
    throw new Error(
        "MediaPipe → Gandi must run unsandboxed."
    );
}


// ========================================================
// REGISTER EXTENSION
// ========================================================

Scratch.extensions.register(
    new MediaPipeToGandi()
);
