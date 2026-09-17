import { it } from "node:test"
import type { SonicBoom, SonicBoomOpts } from "sonic-boom"
import { expect } from "tstyche"
import build from "../pino-roll.js"
import type { PinoRollOptions } from "../pino-roll.js"

it("options `file` is required", () => {
    expect(build).type.not.toBeCallableWith({})
    expect(build).type.toBeCallableWith({ file: "test.log" })
})

it("should return a promise with SonicBoom", () => {
    expect(build({ file: "test.log" })).type.toBe<Promise<SonicBoom>>()
})

it("sonic-boom options except `dest` can pass to pino-roll", () => {
    expect<Omit<SonicBoomOpts, "dest">>().type.toBeAssignableFrom<PinoRollOptions>()
})