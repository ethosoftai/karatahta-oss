#!/usr/bin/env python3
"""Persistent, line-delimited JSON Manim renderer.

The Node backend keeps this process warm, sends validated atomic actions over
stdin, reads lifecycle events from stdout, and receives fragmented MP4 bytes on
file descriptor 3.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import traceback
from dataclasses import dataclass
from typing import Any

from manim import (
    Arrow,
    Circle,
    Create,
    FadeOut,
    GrowArrow,
    Indicate,
    Line,
    Rectangle,
    Scene,
    Text,
    Transform,
    Write,
    config,
)
from manim.renderer.cairo_renderer import CairoRenderer


def emit(event: str, **payload: Any) -> None:
    sys.stdout.write(json.dumps({"event": event, **payload}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def clamp(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return min(maximum, max(minimum, number))


def safe_text(value: Any, limit: int = 360) -> str:
    return str(value or "").strip()[:limit]


def safe_color(value: Any, fallback: str) -> str:
    color = safe_text(value, 24)
    if color.startswith("#") and len(color) in {4, 7, 9}:
        return color
    named_colors = {
        "white": "#f8fafc",
        "yellow": "#fde68a",
        "blue": "#93c5fd",
        "green": "#86efac",
        "red": "#fca5a5",
        "purple": "#c4b5fd",
        "orange": "#fdba74",
        "gray": "#cbd5e1",
        "grey": "#cbd5e1",
    }
    return named_colors.get(color.lower(), fallback)


@dataclass
class StreamSettings:
    width: int = 1280
    height: int = 720
    fps: int = 60
    crf: int = 20
    preset: str = "veryfast"
    fragment_seconds: float = 5.0
    background: str = "#071512"


class RawFrameRenderer(CairoRenderer):
    def __init__(self, frame_pipe: Any, *args: Any, **kwargs: Any) -> None:
        self.frame_pipe = frame_pipe
        self.frame_count = 0
        super().__init__(*args, **kwargs)

    def add_frame(self, frame: Any, num_frames: int = 1) -> None:
        if self.skip_animations:
            return
        payload = frame.tobytes()
        for _ in range(max(1, int(num_frames))):
            self.frame_pipe.write(payload)
            self.frame_count += 1
        self.time += max(1, int(num_frames)) / self.camera.frame_rate


class AudioFeeder(threading.Thread):
    def __init__(self, output_pipe: Any) -> None:
        super().__init__(name="live-manim-audio", daemon=True)
        self.output_pipe = output_pipe
        self.items: queue.Queue[str | None] = queue.Queue()
        self.error: Exception | None = None

    def enqueue(self, audio_path: str) -> None:
        self.items.put(audio_path)

    def finish(self) -> None:
        self.items.put(None)

    def run(self) -> None:
        try:
            while True:
                audio_path = self.items.get()
                if audio_path is None:
                    break
                decoder = subprocess.Popen(
                    [
                        "ffmpeg",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-i",
                        audio_path,
                        "-f",
                        "s16le",
                        "-ar",
                        "48000",
                        "-ac",
                        "1",
                        "pipe:1",
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                assert decoder.stdout is not None
                while chunk := decoder.stdout.read(64 * 1024):
                    self.output_pipe.write(chunk)
                stderr = decoder.stderr.read().decode("utf-8", errors="replace") if decoder.stderr else ""
                code = decoder.wait()
                if code != 0:
                    raise RuntimeError(f"Audio decode failed ({code}): {stderr[-800:]}")
        except Exception as error:  # pragma: no cover - surfaced through worker events
            self.error = error
        finally:
            try:
                self.output_pipe.close()
            except BrokenPipeError:
                pass


class LiveManimSession:
    def __init__(self, settings: StreamSettings) -> None:
        self.settings = settings
        self.ffmpeg: subprocess.Popen[bytes] | None = None
        self.frame_pipe: Any = None
        self.audio_pipe: Any = None
        self.audio_feeder: AudioFeeder | None = None
        self.renderer: RawFrameRenderer | None = None
        self.scene: Scene | None = None
        self.objects: dict[str, Any] = {}
        self.segment_start = 0.0
        self.segment_duration = 1.0
        self.expected_duration = 0.0
        self.started = False

    @property
    def elapsed(self) -> float:
        if not self.renderer:
            return 0.0
        return self.renderer.frame_count / self.settings.fps

    def start(self) -> None:
        if self.started:
            raise RuntimeError("Live Manim session already started.")

        fragment_frames = max(
            1,
            round(self.settings.fps * self.settings.fragment_seconds),
        )
        fragment_microseconds = max(
            1,
            round(self.settings.fragment_seconds * 1_000_000),
        )

        config.renderer = "cairo"
        config.pixel_width = self.settings.width
        config.pixel_height = self.settings.height
        config.frame_rate = self.settings.fps
        config.background_color = self.settings.background
        config.disable_caching = True
        config.write_to_movie = False
        config.save_last_frame = False
        config.format = None
        config.progress_bar = "none"

        video_read, video_write = os.pipe()
        audio_read, audio_write = os.pipe()
        stream_output = os.fdopen(3, "wb", buffering=0, closefd=False)
        self.ffmpeg = subprocess.Popen(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-thread_queue_size",
                "512",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                f"{self.settings.width}x{self.settings.height}",
                "-r",
                str(self.settings.fps),
                "-i",
                f"pipe:{video_read}",
                "-thread_queue_size",
                "512",
                "-f",
                "s16le",
                "-ar",
                "48000",
                "-ac",
                "1",
                "-i",
                f"pipe:{audio_read}",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-profile:v",
                "main",
                "-level:v",
                "4.2",
                "-preset",
                self.settings.preset,
                "-tune",
                "zerolatency",
                "-crf",
                str(self.settings.crf),
                "-pix_fmt",
                "yuv420p",
                "-g",
                str(fragment_frames),
                "-keyint_min",
                str(fragment_frames),
                "-sc_threshold",
                "0",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-movflags",
                "frag_keyframe+empty_moov+default_base_moof",
                "-frag_duration",
                str(fragment_microseconds),
                "-flush_packets",
                "1",
                "-f",
                "mp4",
                "pipe:1",
            ],
            stdin=subprocess.DEVNULL,
            stdout=stream_output,
            stderr=subprocess.PIPE,
            pass_fds=(video_read, audio_read),
        )
        os.close(video_read)
        os.close(audio_read)
        self.frame_pipe = os.fdopen(video_write, "wb", buffering=0)
        self.audio_pipe = os.fdopen(audio_write, "wb", buffering=0)
        self.audio_feeder = AudioFeeder(self.audio_pipe)
        self.audio_feeder.start()
        self.renderer = RawFrameRenderer(self.frame_pipe)
        self.scene = Scene(renderer=self.renderer)
        self.scene.setup()
        self.started = True
        emit(
            "stream_started",
            width=self.settings.width,
            height=self.settings.height,
            fps=self.settings.fps,
            fragment_seconds=self.settings.fragment_seconds,
        )

    def begin_segment(self, payload: dict[str, Any]) -> None:
        if not self.started or not self.audio_feeder:
            raise RuntimeError("Live Manim session has not started.")
        audio_path = safe_text(payload.get("audio_path"), 2000)
        if not audio_path or not os.path.isfile(audio_path):
            raise RuntimeError(f"Audio file does not exist: {audio_path}")
        self.segment_start = self.expected_duration
        self.segment_duration = clamp(payload.get("duration_seconds"), 0.5, 600.0, 10.0)
        self.expected_duration += self.segment_duration
        self.audio_feeder.enqueue(audio_path)
        emit(
            "segment_started",
            segment_id=safe_text(payload.get("segment_id"), 80),
            offset_seconds=round(self.segment_start, 3),
            duration_seconds=round(self.segment_duration, 3),
        )

    def wait_until(self, target_seconds: float) -> None:
        wait_seconds = target_seconds - self.elapsed
        if wait_seconds > (1 / self.settings.fps):
            assert self.scene is not None
            self.scene.wait(wait_seconds, frozen_frame=True)

    def point(self, x: Any, y: Any) -> list[float]:
        normalized_x = clamp(x, 0, 100, 50)
        normalized_y = clamp(y, 0, 100, 50)
        return [
            ((normalized_x / 100) * (16 / 9) * 8) - ((16 / 9) * 4),
            4 - ((normalized_y / 100) * 8),
            0,
        ]

    def fit_text(self, mobject: Any, max_width: float = 6.3) -> Any:
        if mobject.width > max_width:
            mobject.scale_to_fit_width(max_width)
        return mobject

    def text_mobject(self, payload: dict[str, Any]) -> Any:
        text = safe_text(payload.get("text"))
        font_size = clamp(payload.get("font_size"), 2, 12, 4.4) * 7.5
        color = safe_color(payload.get("color"), "#f8fafc")
        mobject = Text(text, font_size=font_size, color=color)
        max_width = 11.8 if payload.get("type") == "title" else 6.2
        self.fit_text(mobject, max_width)
        mobject.move_to(self.point(payload.get("x"), payload.get("y")))
        return mobject

    def shape_mobject(self, payload: dict[str, Any]) -> tuple[Any, Any]:
        action_type = payload.get("type")
        color = safe_color(payload.get("color"), "#93c5fd")
        stroke_width = clamp(payload.get("stroke_width"), 0.2, 4, 0.7) * 4
        start = self.point(payload.get("x"), payload.get("y"))
        end = self.point(payload.get("x2"), payload.get("y2"))

        if action_type == "line":
            mobject = Line(start, end, color=color, stroke_width=stroke_width)
            return mobject, Create(mobject)
        if action_type == "arrow":
            mobject = Arrow(start, end, color=color, stroke_width=stroke_width, buff=0)
            return mobject, GrowArrow(mobject)
        if action_type == "circle":
            radius = clamp(payload.get("radius"), 1, 50, 9) * 0.07
            mobject = Circle(radius=radius, color=color, stroke_width=stroke_width)
            mobject.move_to(start)
            return mobject, Create(mobject)
        if action_type == "rectangle":
            width = clamp(payload.get("width"), 1, 100, 24) * 0.095
            height = clamp(payload.get("height"), 1, 100, 18) * 0.07
            mobject = Rectangle(width=width, height=height, color=color, stroke_width=stroke_width)
            mobject.move_to(start)
            return mobject, Create(mobject)
        raise RuntimeError(f"Unsupported shape action: {action_type}")

    def execute(self, payload: dict[str, Any]) -> None:
        if not self.scene:
            raise RuntimeError("Live Manim session has not started.")
        action_type = safe_text(payload.get("type"), 24).lower()
        action_id = safe_text(payload.get("id"), 80)
        at_percent = clamp(payload.get("at_percent"), 0, 100, 0)
        target_seconds = self.segment_start + ((at_percent / 100) * self.segment_duration)
        self.wait_until(target_seconds)
        segment_end = self.segment_start + self.segment_duration
        remaining_seconds = max(0.0, segment_end - self.elapsed)
        run_time = min(
            clamp(payload.get("duration_ms"), 150, 5000, 1000) / 1000,
            remaining_seconds,
        )
        emit(
            "action_started",
            action_id=action_id,
            action_type=action_type,
            timeline_seconds=round(self.elapsed, 3),
        )

        if run_time < (1 / self.settings.fps):
            emit(
                "action_completed",
                action_id=action_id,
                action_type=action_type,
                timeline_seconds=round(self.elapsed, 3),
                skipped=True,
            )
            return

        if action_type in {"title", "write", "equation"}:
            mobject = self.text_mobject(payload)
            existing = self.objects.get(action_id)
            if existing is not None:
                self.scene.play(Transform(existing, mobject), run_time=run_time)
            else:
                self.objects[action_id] = mobject
                self.scene.play(Write(mobject), run_time=run_time)
        elif action_type in {"line", "arrow", "circle", "rectangle"}:
            mobject, animation = self.shape_mobject(payload)
            existing = self.objects.get(action_id)
            if existing is not None:
                self.scene.play(Transform(existing, mobject), run_time=run_time)
            else:
                self.objects[action_id] = mobject
                self.scene.play(animation, run_time=run_time)
        elif action_type == "highlight":
            target_id = safe_text(payload.get("target_id") or action_id, 80)
            target = self.objects.get(target_id)
            if target is not None:
                self.scene.play(Indicate(target), run_time=run_time)
        elif action_type == "remove":
            target_id = safe_text(payload.get("target_id") or action_id, 80)
            target = self.objects.pop(target_id, None)
            if target is not None:
                self.scene.play(FadeOut(target), run_time=run_time)
        elif action_type == "clear":
            if self.scene.mobjects:
                self.scene.play(*[FadeOut(item) for item in list(self.scene.mobjects)], run_time=run_time)
            self.objects.clear()
        elif action_type == "wait":
            self.scene.wait(run_time, frozen_frame=True)
        else:
            raise RuntimeError(f"Unsupported live Manim action: {action_type}")

        emit(
            "action_completed",
            action_id=action_id,
            action_type=action_type,
            timeline_seconds=round(self.elapsed, 3),
        )

    def finish(self) -> None:
        if not self.started or not self.scene or not self.renderer:
            return
        self.wait_until(self.expected_duration)
        self.scene.tear_down()
        self.frame_pipe.close()
        assert self.audio_feeder is not None
        self.audio_feeder.finish()
        self.audio_feeder.join(timeout=120)
        if self.audio_feeder.is_alive():
            raise RuntimeError("Audio feeder did not finish in time.")
        if self.audio_feeder.error:
            raise self.audio_feeder.error
        assert self.ffmpeg is not None
        stderr = self.ffmpeg.stderr.read().decode("utf-8", errors="replace") if self.ffmpeg.stderr else ""
        code = self.ffmpeg.wait(timeout=120)
        if code != 0:
            raise RuntimeError(f"Live FFmpeg failed ({code}): {stderr[-1600:]}")
        emit(
            "finished",
            duration_seconds=round(self.elapsed, 3),
            frames=self.renderer.frame_count,
        )


def main() -> None:
    emit("ready", manim_version="0.20.1")
    session: LiveManimSession | None = None
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as error:
            emit(
                "input_error",
                message=str(error),
                raw_line=line[:500],
            )
            continue
        try:
            message_type = message.get("type")
            if message_type == "start":
                settings = StreamSettings(
                    width=int(clamp(message.get("width"), 320, 1920, 1280)),
                    height=int(clamp(message.get("height"), 180, 1080, 720)),
                    fps=int(clamp(message.get("fps"), 10, 60, 60)),
                    crf=int(clamp(message.get("crf"), 18, 30, 20)),
                    preset=safe_text(message.get("preset"), 12)
                    if safe_text(message.get("preset"), 12) in {"veryfast", "faster", "fast", "medium"}
                    else "veryfast",
                    fragment_seconds=clamp(message.get("fragment_seconds"), 1, 4, 1),
                    background=safe_text(message.get("background"), 24) or "#071512",
                )
                session = LiveManimSession(settings)
                session.start()
            elif message_type == "segment":
                if not session:
                    raise RuntimeError("Start message is required before segment.")
                session.begin_segment(message)
            elif message_type == "action":
                if not session:
                    raise RuntimeError("Start message is required before action.")
                command = message.get("command") or {}
                try:
                    session.execute(command)
                except Exception as action_error:
                    emit(
                        "action_error",
                        action_id=safe_text(command.get("id"), 80),
                        action_type=safe_text(command.get("type"), 24),
                        message=str(action_error),
                        traceback=traceback.format_exc(limit=8),
                    )
                    continue
            elif message_type == "finish":
                if session:
                    session.finish()
                return
            elif message_type == "shutdown":
                return
            else:
                raise RuntimeError(f"Unknown worker message: {message_type}")
        except Exception as error:  # pragma: no cover - integration path
            emit(
                "error",
                message=str(error),
                traceback=traceback.format_exc(limit=8),
            )
            return


if __name__ == "__main__":
    main()
