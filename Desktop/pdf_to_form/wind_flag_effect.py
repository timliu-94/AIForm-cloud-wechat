from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


DEFAULT_OUTPUT_DIR = Path("flag_wind_frames")


def bilinear_sample(image: np.ndarray, sample_x: np.ndarray, sample_y: np.ndarray) -> np.ndarray:
    height, width, channels = image.shape

    x0 = np.floor(sample_x).astype(np.int32)
    y0 = np.floor(sample_y).astype(np.int32)
    x1 = x0 + 1
    y1 = y0 + 1

    valid = (sample_x >= 0) & (sample_x <= width - 1) & (sample_y >= 0) & (sample_y <= height - 1)

    x0 = np.clip(x0, 0, width - 1)
    x1 = np.clip(x1, 0, width - 1)
    y0 = np.clip(y0, 0, height - 1)
    y1 = np.clip(y1, 0, height - 1)

    wx = sample_x - x0
    wy = sample_y - y0

    top_left = image[y0, x0]
    top_right = image[y0, x1]
    bottom_left = image[y1, x0]
    bottom_right = image[y1, x1]

    top = top_left * (1.0 - wx[..., None]) + top_right * wx[..., None]
    bottom = bottom_left * (1.0 - wx[..., None]) + bottom_right * wx[..., None]
    sampled = top * (1.0 - wy[..., None]) + bottom * wy[..., None]
    sampled *= valid[..., None]

    return sampled


def render_wind_frame(
    flag: Image.Image,
    frame_index: int,
    frame_count: int,
    amplitude: float,
    cycles: float,
    shade_strength: float,
    right_edge_lift: float,
) -> Image.Image:
    source = np.asarray(flag.convert("RGBA"), dtype=np.float32)
    height, width, _ = source.shape
    phase = (frame_index / frame_count) * math.tau

    pad_x = int(math.ceil(amplitude * 1.5 + 8))
    pad_y = int(math.ceil(amplitude * 2.5 + abs(right_edge_lift) + 8))
    canvas_width = width + pad_x * 2
    canvas_height = height + pad_y * 2

    out_x, out_y = np.meshgrid(
        np.arange(canvas_width, dtype=np.float32),
        np.arange(canvas_height, dtype=np.float32),
    )
    local_x = out_x - pad_x
    local_y = out_y - pad_y

    x_ratio = np.clip(local_x / max(width - 1, 1), 0.0, 1.0)
    envelope = x_ratio**0.75
    wave = np.sin((x_ratio * cycles * math.tau) + phase)
    fine_wave = np.sin((x_ratio * cycles * 2.15 * math.tau) + phase * 1.35)

    vertical_offset = amplitude * envelope * (wave + fine_wave * 0.22)
    vertical_offset += right_edge_lift * (x_ratio**1.6) * np.sin(phase + math.pi * 0.25)

    horizontal_offset = amplitude * 0.28 * envelope * np.cos((x_ratio * cycles * math.tau) + phase)

    sample_x = local_x - horizontal_offset
    sample_y = local_y - vertical_offset

    rgba = bilinear_sample(source, sample_x, sample_y)

    shade = 1.0 + shade_strength * envelope * np.cos((x_ratio * cycles * math.tau) + phase - 0.45)
    shade += shade_strength * 0.35 * envelope * np.cos((x_ratio * cycles * 2.0 * math.tau) + phase)
    rgba[..., :3] = np.clip(rgba[..., :3] * shade[..., None], 0, 255)

    alpha_fade = np.clip((width - sample_x) / 8.0, 0.0, 1.0)
    rgba[..., 3] *= alpha_fade

    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def add_soft_shadow(frame: Image.Image, opacity: int = 70, blur: int = 10) -> Image.Image:
    alpha = frame.getchannel("A")
    shadow = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    shadow_alpha = alpha.filter(ImageFilter.GaussianBlur(blur)).point(lambda value: value * opacity // 255)
    shadow.putalpha(shadow_alpha)

    result = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    result.alpha_composite(shadow, (4, 8))
    result.alpha_composite(frame)
    return result


def create_wind_effect(
    input_path: Path,
    output_dir: Path,
    frames: int,
    width: int | None,
    amplitude: float,
    cycles: float,
    shade_strength: float,
    gif_path: Path | None,
    duration: int,
    shadow: bool,
) -> None:
    if frames < 2:
        raise ValueError("--frames must be at least 2.")
    if amplitude < 0:
        raise ValueError("--amplitude must be greater than or equal to 0.")

    flag = Image.open(input_path).convert("RGBA")
    if width:
        new_height = round(flag.height * (width / flag.width))
        flag = flag.resize((width, new_height), Image.Resampling.LANCZOS)

    output_dir.mkdir(parents=True, exist_ok=True)

    rendered_frames: list[Image.Image] = []
    for frame_index in range(frames):
        frame = render_wind_frame(
            flag=flag,
            frame_index=frame_index,
            frame_count=frames,
            amplitude=amplitude,
            cycles=cycles,
            shade_strength=shade_strength,
            right_edge_lift=amplitude * 0.42,
        )
        if shadow:
            frame = add_soft_shadow(frame)

        output_path = output_dir / f"flag_wind_{frame_index + 1:03d}.png"
        frame.save(output_path)
        rendered_frames.append(frame)
        print(f"saved {output_path}")

    if gif_path:
        gif_path.parent.mkdir(parents=True, exist_ok=True)
        rendered_frames[0].save(
            gif_path,
            save_all=True,
            append_images=rendered_frames[1:],
            duration=duration,
            loop=0,
            disposal=2,
        )
        print(f"saved {gif_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create wind-blown waving PNG frames from a flag image."
    )
    parser.add_argument("input", type=Path, help="Input flag image path, for example flag.png.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for PNG frames.",
    )
    parser.add_argument("--frames", type=int, default=24, help="Number of PNG frames to render.")
    parser.add_argument("--width", type=int, default=None, help="Optional resized flag width.")
    parser.add_argument("--amplitude", type=float, default=24.0, help="Wave height in pixels.")
    parser.add_argument("--cycles", type=float, default=2.2, help="Wave count across the flag width.")
    parser.add_argument(
        "--shade-strength",
        type=float,
        default=0.18,
        help="Light and shadow strength for cloth folds.",
    )
    parser.add_argument("--gif", type=Path, default=None, help="Optional animated GIF output path.")
    parser.add_argument("--duration", type=int, default=45, help="GIF frame duration in milliseconds.")
    parser.add_argument("--no-shadow", action="store_true", help="Disable transparent soft shadow.")
    args = parser.parse_args()

    create_wind_effect(
        input_path=args.input,
        output_dir=args.output_dir,
        frames=args.frames,
        width=args.width,
        amplitude=args.amplitude,
        cycles=args.cycles,
        shade_strength=args.shade_strength,
        gif_path=args.gif,
        duration=args.duration,
        shadow=not args.no_shadow,
    )


if __name__ == "__main__":
    main()
