#!/usr/bin/env python3
import json
import statistics
import subprocess
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "test" / "fixtures" / "progressive_benchmark_scene.py"


def duration_seconds(file_path):
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(file_path)
        ],
        capture_output=True,
        text=True,
        check=False
    )
    if result.returncode:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def video_spec(file_path):
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate,codec_name",
            "-of", "json", str(file_path)
        ],
        capture_output=True,
        text=True,
        check=False
    )
    if result.returncode:
        return None
    stream = json.loads(result.stdout)["streams"][0]
    return {
        "width": stream["width"],
        "height": stream["height"],
        "fps": stream["avg_frame_rate"],
        "codec": stream["codec_name"]
    }


def av_start_drift_ms(file_path):
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries",
            "stream=codec_type,start_time", "-of", "json", str(file_path)
        ],
        capture_output=True,
        text=True,
        check=True
    )
    streams = json.loads(result.stdout)["streams"]
    starts = {
        stream["codec_type"]: float(stream.get("start_time") or 0)
        for stream in streams
    }
    return round(abs(starts.get("video", 0) - starts.get("audio", 0)) * 1000, 3)


def normalize_fragment(source, output, audio, audio_start, duration):
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", str(source),
            "-ss", f"{audio_start:.3f}", "-i", str(audio),
            "-filter_complex",
            f"[1:a]apad,atrim=0:{duration:.3f},asetpts=PTS-STARTPTS[aout]",
            "-map", "0:v:0", "-map", "[aout]",
            "-t", f"{duration:.3f}", "-c:v", "copy", "-c:a", "aac",
            "-movflags", "+empty_moov+default_base_moof+frag_keyframe+omit_tfhd_offset",
            "-frag_duration", "1000000", "-video_track_timescale", "90000",
            str(output)
        ],
        capture_output=True,
        text=True,
        check=False
    )
    return result.returncode == 0 and duration_seconds(output)


def run_once(index):
    with tempfile.TemporaryDirectory(prefix=f"kara-benchmark-{index}-") as media_dir:
        audio_path = Path(media_dir) / "speech-ready.m4a"
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", "-f", "lavfi",
                "-i", "sine=frequency=440:duration=24", "-c:a", "aac", str(audio_path)
            ],
            check=True
        )
        fragment_dir = Path(media_dir) / "normalized"
        fragment_dir.mkdir()
        started = time.monotonic()
        process = subprocess.Popen(
            [
                "python", "-m", "manim", "-qm",
                "--resolution", "1280,720", "--fps", "30",
                str(SCENE), "ProgressiveBenchmark",
                "--media_dir", media_dir,
                "--disable_caching"
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        seen = set()
        ready_duration = 0.0
        first_partial = None
        playback_ready = None
        rendered_spec = None
        normalized_outputs = []
        while process.poll() is None:
            for partial in Path(media_dir).glob("**/partial_movie_files/**/*.mp4"):
                if partial in seen:
                    continue
                duration = duration_seconds(partial)
                if not duration:
                    continue
                output = fragment_dir / f"partial-{len(seen):05d}.mp4"
                if not normalize_fragment(partial, output, audio_path, ready_duration, duration):
                    continue
                seen.add(partial)
                normalized_outputs.append(output)
                rendered_spec = rendered_spec or video_spec(output)
                ready_duration += duration
                elapsed = time.monotonic() - started
                first_partial = first_partial or elapsed
                if ready_duration >= 6 and playback_ready is None:
                    playback_ready = elapsed
            time.sleep(0.05)
        stdout, stderr = process.communicate()
        elapsed = time.monotonic() - started
        if process.returncode:
            raise RuntimeError((stdout + "\n" + stderr)[-4000:])
        concat_list = Path(media_dir) / "concat.txt"
        concat_list.write_text(
            "\n".join(f"file '{item}'" for item in normalized_outputs),
            encoding="utf-8"
        )
        final_path = Path(media_dir) / "same-partials-final.mp4"
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
                "-i", str(concat_list), "-c", "copy", "-movflags", "+faststart",
                str(final_path)
            ],
            check=True
        )
        return {
            "run": index,
            "firstPartialSeconds": round(first_partial or elapsed, 3),
            "playbackReadySeconds": round(playback_ready or elapsed, 3),
            "renderCompleteSeconds": round(elapsed, 3),
            "partialCount": len(seen),
            "bufferedSeconds": round(ready_duration, 3),
            "video": rendered_spec,
            "samePartialFinalSeconds": round(duration_seconds(final_path), 3),
            "avStartDriftMs": av_start_drift_ms(final_path)
        }


results = [run_once(index) for index in range(1, 4)]
ready = sorted(item["playbackReadySeconds"] for item in results)
summary = {
    "runs": results,
    "medianPlaybackReadySeconds": round(statistics.median(ready), 3),
    "p95PlaybackReadySeconds": round(ready[-1], 3),
    "target": "1280x720@30fps, 6s buffer"
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
