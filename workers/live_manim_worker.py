#!/usr/bin/env python3
"""Persistent, line-delimited JSON Manim renderer.

The Node backend keeps this process warm, sends validated atomic actions over
stdin, reads lifecycle events from stdout, and receives fragmented MP4 bytes on
file descriptor 3.
"""

from __future__ import annotations

import json
import math
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
    Dot,
    FadeIn,
    FadeOut,
    GrowArrow,
    Indicate,
    Line,
    Polygon,
    Rectangle,
    RoundedRectangle,
    Scene,
    Text,
    Transform,
    VGroup,
    VMobject,
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

    def screen_size(self, width: Any, height: Any) -> tuple[float, float]:
        return (
            clamp(width, 1, 100, 24) * ((16 / 9) * 8 / 100),
            clamp(height, 1, 100, 18) * (8 / 100),
        )

    def label_mobject(
        self,
        text: Any,
        *,
        font_size: float = 26,
        color: str = "#f8fafc",
        max_width: float = 3.0,
    ) -> Any:
        label = Text(safe_text(text, 90), font_size=font_size, color=color)
        return self.fit_text(label, max_width)

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
        if action_type == "dot":
            radius = clamp(payload.get("radius"), 1, 50, 3) * 0.025
            mobject = Dot(start, radius=radius, color=color)
            return mobject, FadeIn(mobject, scale=1.8)
        if action_type in {"polyline", "polygon"}:
            points = [
                self.point(point[0], point[1])
                for point in payload.get("points", [])
                if isinstance(point, list) and len(point) >= 2
            ]
            if action_type == "polygon":
                mobject = Polygon(
                    *points,
                    color=color,
                    stroke_width=stroke_width,
                    fill_color=color,
                    fill_opacity=clamp(payload.get("fill_opacity"), 0, 0.85, 0.16),
                )
            else:
                mobject = VMobject(color=color, stroke_width=stroke_width)
                mobject.set_points_as_corners(points)
            return mobject, Create(mobject)
        raise RuntimeError(f"Unsupported shape action: {action_type}")

    def axes_mobject(self, payload: dict[str, Any]) -> Any:
        color = safe_color(payload.get("color"), "#cbd5e1")
        center = self.point(payload.get("x", 50), payload.get("y", 56))
        width, height = self.screen_size(payload.get("width", 78), payload.get("height", 56))
        left = center[0] - (width / 2)
        right = center[0] + (width / 2)
        bottom = center[1] - (height / 2)
        top = center[1] + (height / 2)
        group = VGroup(
            Arrow([left, bottom, 0], [right, bottom, 0], buff=0, color=color, stroke_width=2.5),
            Arrow([left, bottom, 0], [left, top, 0], buff=0, color=color, stroke_width=2.5),
        )
        for index in range(1, 6):
            x_pos = left + ((width * index) / 6)
            y_pos = bottom + ((height * index) / 6)
            group.add(Line([x_pos, bottom - 0.06, 0], [x_pos, bottom + 0.06, 0], color=color))
            group.add(Line([left - 0.06, y_pos, 0], [left + 0.06, y_pos, 0], color=color))
        x_label = safe_text(payload.get("x_label"), 52)
        y_label = safe_text(payload.get("y_label"), 52)
        if x_label:
            label = self.label_mobject(x_label, font_size=21, color=color, max_width=2.1)
            label.move_to([right - 0.45, bottom - 0.32, 0])
            group.add(label)
        if y_label:
            label = self.label_mobject(y_label, font_size=21, color=color, max_width=2.1)
            label.move_to([left + 0.5, top + 0.24, 0])
            group.add(label)
        return group

    def plot_mobject(self, payload: dict[str, Any]) -> Any:
        color = safe_color(payload.get("color"), "#fde68a")
        stroke_width = clamp(payload.get("stroke_width"), 0.2, 4, 0.8) * 4
        points = [
            self.point(point[0], point[1])
            for point in payload.get("points", [])
            if isinstance(point, list) and len(point) >= 2
        ]
        path = VMobject(color=color, stroke_width=stroke_width)
        if payload.get("smooth") and len(points) >= 3:
            path.set_points_smoothly(points)
        else:
            path.set_points_as_corners(points)
        group = VGroup()
        if payload.get("show_axes", True):
            group.add(self.axes_mobject({**payload, "color": "#64748b"}))
        group.add(path)
        group.add(*[Dot(point, radius=0.055, color=color) for point in points])
        text = safe_text(payload.get("text"), 90)
        if text:
            label = self.label_mobject(text, font_size=25, color=color, max_width=4.0)
            label.move_to(self.point(payload.get("x", 50), max(8, clamp(payload.get("y", 56), 0, 100, 56) - 34)))
            group.add(label)
        return group

    def bar_chart_mobject(self, payload: dict[str, Any]) -> Any:
        labels = [safe_text(item, 24) for item in payload.get("labels", [])][:8]
        values = [float(item) for item in payload.get("values", [])][: len(labels)]
        count = min(len(labels), len(values))
        color = safe_color(payload.get("color"), "#60a5fa")
        center = self.point(payload.get("x", 50), payload.get("y", 55))
        width, height = self.screen_size(payload.get("width", 76), payload.get("height", 58))
        left = center[0] - (width / 2)
        bottom = center[1] - (height / 2)
        usable_height = max(0.8, height - 0.65)
        slot_width = width / max(1, count)
        bar_width = min(1.15, slot_width * 0.58)
        maximum = max([abs(value) for value in values[:count]] + [1.0])
        group = VGroup(Line([left, bottom, 0], [left + width, bottom, 0], color="#64748b"))
        for index, (label_text, value) in enumerate(zip(labels[:count], values[:count])):
            bar_height = max(0.08, usable_height * (abs(value) / maximum))
            bar_color = color if value >= 0 else "#fca5a5"
            bar = Rectangle(
                width=bar_width,
                height=bar_height,
                color=bar_color,
                fill_color=bar_color,
                fill_opacity=0.66,
                stroke_width=1.8,
            )
            x_pos = left + ((index + 0.5) * slot_width)
            bar.move_to([x_pos, bottom + (bar_height / 2), 0])
            label = self.label_mobject(label_text, font_size=19, color="#e2e8f0", max_width=slot_width * 0.9)
            label.move_to([x_pos, bottom - 0.28, 0])
            group.add(bar, label)
            if payload.get("show_values", True):
                value_label = self.label_mobject(
                    f"{value:g}",
                    font_size=19,
                    color="#f8fafc",
                    max_width=slot_width * 0.8,
                )
                value_label.move_to([x_pos, bottom + bar_height + 0.2, 0])
                group.add(value_label)
        return group

    def diagram_mobject(self, payload: dict[str, Any]) -> Any:
        nodes = payload.get("nodes", [])[:7]
        node_positions = {
            safe_text(node.get("id"), 40): self.point(node.get("x"), node.get("y"))
            for node in nodes
        }
        edges_group = VGroup()
        for edge in payload.get("edges", [])[:10]:
            start = node_positions.get(safe_text(edge.get("from"), 40))
            end = node_positions.get(safe_text(edge.get("to"), 40))
            if start is None or end is None:
                continue
            color = safe_color(edge.get("color"), "#94a3b8")
            distance = math.hypot(end[0] - start[0], end[1] - start[1])
            arrow = Arrow(
                start,
                end,
                buff=min(1.25, distance * 0.28),
                color=color,
                stroke_width=2.6,
            )
            edges_group.add(arrow)
            edge_label = safe_text(edge.get("label"), 42)
            if edge_label:
                label = self.label_mobject(edge_label, font_size=17, color=color, max_width=1.8)
                label.move_to([
                    (start[0] + end[0]) / 2,
                    ((start[1] + end[1]) / 2) + 0.25,
                    0,
                ])
                edges_group.add(label)
        nodes_group = VGroup()
        fill_opacity = clamp(payload.get("fill_opacity"), 0, 0.85, 0.16)
        for node in nodes:
            position = node_positions.get(safe_text(node.get("id"), 40))
            color = safe_color(node.get("color"), "#93c5fd")
            if safe_text(node.get("shape"), 12) == "circle":
                container = Circle(
                    radius=0.68,
                    color=color,
                    fill_color=color,
                    fill_opacity=fill_opacity,
                    stroke_width=2.5,
                )
                label_width = 1.05
            else:
                container = RoundedRectangle(
                    width=2.45,
                    height=1.05,
                    corner_radius=0.16,
                    color=color,
                    fill_color=color,
                    fill_opacity=fill_opacity,
                    stroke_width=2.5,
                )
                label_width = 2.05
            container.move_to(position)
            label = self.label_mobject(
                node.get("text"),
                font_size=22,
                color="#f8fafc",
                max_width=label_width,
            )
            label.move_to(position)
            nodes_group.add(VGroup(container, label))
        return VGroup(edges_group, nodes_group)

    def comparison_mobject(self, payload: dict[str, Any]) -> Any:
        center = self.point(payload.get("x", 50), payload.get("y", 55))
        width, height = self.screen_size(payload.get("width", 80), payload.get("height", 58))
        gap = 0.35
        panel_width = (width - gap) / 2
        panel_height = height
        color = safe_color(payload.get("color"), "#c4b5fd")
        fill_opacity = clamp(payload.get("fill_opacity"), 0, 0.85, 0.12)
        group = VGroup()
        columns = [
            (-1, safe_text(payload.get("left_title"), 52) or "Once", payload.get("left_items", []), "#93c5fd"),
            (1, safe_text(payload.get("right_title"), 52) or "Sonra", payload.get("right_items", []), "#86efac"),
        ]
        for direction, title, items, accent in columns:
            x_pos = center[0] + (direction * ((panel_width + gap) / 2))
            panel = RoundedRectangle(
                width=panel_width,
                height=panel_height,
                corner_radius=0.18,
                color=color,
                fill_color=color,
                fill_opacity=fill_opacity,
                stroke_width=2.2,
            )
            panel.move_to([x_pos, center[1], 0])
            header = self.label_mobject(title, font_size=27, color=accent, max_width=panel_width - 0.4)
            header.move_to([x_pos, center[1] + (panel_height / 2) - 0.48, 0])
            column = VGroup(panel, header)
            for index, item in enumerate(items[:6]):
                bullet = self.label_mobject(
                    f"• {safe_text(item, 72)}",
                    font_size=21,
                    color="#e2e8f0",
                    max_width=panel_width - 0.45,
                )
                bullet.align_to(panel, direction=[-1, 0, 0])
                bullet.shift([0.23, 0, 0])
                bullet.move_to([
                    x_pos,
                    center[1] + (panel_height / 2) - 1.05 - (index * 0.48),
                    0,
                ])
                column.add(bullet)
            group.add(column)
        return group

    def timeline_mobject(self, payload: dict[str, Any]) -> Any:
        items = [safe_text(item, 90) for item in payload.get("items", [])][:8]
        center = self.point(payload.get("x", 50), payload.get("y", 54))
        width, _ = self.screen_size(payload.get("width", 80), 10)
        left = center[0] - (width / 2)
        right = center[0] + (width / 2)
        color = safe_color(payload.get("color"), "#93c5fd")
        group = VGroup(Arrow([left, center[1], 0], [right, center[1], 0], buff=0, color=color))
        for index, item in enumerate(items):
            ratio = index / max(1, len(items) - 1)
            x_pos = left + (ratio * width)
            dot = Dot([x_pos, center[1], 0], radius=0.09, color="#fde68a")
            stem_direction = 1 if index % 2 == 0 else -1
            stem_end_y = center[1] + (stem_direction * 0.48)
            stem = Line([x_pos, center[1], 0], [x_pos, stem_end_y, 0], color="#64748b")
            label = self.label_mobject(
                item,
                font_size=20,
                color="#e2e8f0",
                max_width=max(1.2, width / max(2, len(items)) * 0.9),
            )
            label.move_to([x_pos, stem_end_y + (stem_direction * 0.26), 0])
            group.add(stem, dot, label)
        return group

    def semantic_mobject(self, payload: dict[str, Any]) -> Any:
        action_type = payload.get("type")
        if action_type == "axes":
            return self.axes_mobject(payload)
        if action_type == "plot":
            return self.plot_mobject(payload)
        if action_type == "bar_chart":
            return self.bar_chart_mobject(payload)
        if action_type == "diagram":
            return self.diagram_mobject(payload)
        if action_type == "comparison":
            return self.comparison_mobject(payload)
        if action_type == "timeline":
            return self.timeline_mobject(payload)
        raise RuntimeError(f"Unsupported semantic action: {action_type}")

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
        elif action_type in {"line", "arrow", "circle", "rectangle", "dot", "polyline", "polygon"}:
            mobject, animation = self.shape_mobject(payload)
            existing = self.objects.get(action_id)
            if existing is not None:
                self.scene.play(Transform(existing, mobject), run_time=run_time)
            else:
                self.objects[action_id] = mobject
                self.scene.play(animation, run_time=run_time)
        elif action_type in {"axes", "plot", "bar_chart", "diagram", "comparison", "timeline"}:
            mobject = self.semantic_mobject(payload)
            existing = self.objects.get(action_id)
            if existing is not None:
                self.scene.play(Transform(existing, mobject), run_time=run_time)
            else:
                self.objects[action_id] = mobject
                self.scene.play(FadeIn(mobject), run_time=run_time)
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
