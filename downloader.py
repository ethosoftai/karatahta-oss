import yt_dlp

def download_playlist(playlist_url, output_path="downloads"):
    ydl_opts = {
        'outtmpl': f'{output_path}/%(playlist_title)s/%(title)s.%(ext)s',
        'format': 'bestvideo+bestaudio/best',
        'merge_output_format': 'mp4',
        'noplaylist': False,  # if True, only download the video, not the playlist
        'ignoreerrors': True,  # continue downloading even if some videos fail
    }


    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([playlist_url])


if __name__ == "__main__":
    playlist_url = input("insert playlist URL: ")
    download_playlist(playlist_url)