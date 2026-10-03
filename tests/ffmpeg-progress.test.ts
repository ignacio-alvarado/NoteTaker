import { describe, expect, it } from 'vitest'
import { parseDuration, parseProgressTime } from '../src/main/media/ffmpeg'

describe('ffmpeg stderr parsing', () => {
  it('reads the input duration', () => {
    const header =
      "Input #0, mov,mp4, from 'a.mp4':\n  Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s"
    expect(parseDuration(header)).toBe(3723.5)
    expect(parseDuration('no duration here')).toBeNull()
  })

  it('reads the last processed time in a chunk', () => {
    const chunk =
      'size=     256kB time=00:00:10.00 bitrate= 209.7kbits/s speed=20x\rsize=     512kB time=00:00:21.48 bitrate= 195.2kbits/s'
    expect(parseProgressTime(chunk)).toBeCloseTo(21.48)
    expect(parseProgressTime('time=N/A')).toBeNull()
  })
})
