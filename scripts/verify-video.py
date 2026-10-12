"""Read the real WebM stream and decode proof frames using Playwright's FFmpeg."""
from pathlib import Path
import sys,subprocess,re,json,os
ROOT=Path(__file__).resolve().parents[1]
video=ROOT/'deliverables/鲜境_系统演示.webm'
cache=Path(os.environ.get('LOCALAPPDATA',''))/'ms-playwright'
tools=sorted(cache.glob('ffmpeg-*/ffmpeg-win64.exe'))
if not tools:raise SystemExit('Playwright FFmpeg not installed. Run: npx playwright install ffmpeg')
ffmpeg=tools[-1];evidence=ROOT/'docs/evidence';frames=ROOT/'.runtime/video-frames';frames.mkdir(parents=True,exist_ok=True)
read=subprocess.run([str(ffmpeg),'-hide_banner','-i',str(video)],capture_output=True,text=True,encoding='utf-8',errors='replace')
match=re.search(r'Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)',read.stderr);assert match,read.stderr
duration=int(match[1])*3600+int(match[2])*60+float(match[3]);assert 30<duration<900
assert re.search(r'Video: vp8.*1440x1000',read.stderr),read.stderr
for seconds,label in [(2,'opening'),(min(125,duration/2),'business'),(max(0,duration-10),'closing')]:
    decoded=subprocess.run([str(ffmpeg),'-y','-hide_banner','-ss',str(seconds),'-i',str(video),'-frames:v','1','-update','1',str(frames/(label+'.png'))],capture_output=True,text=True,encoding='utf-8',errors='replace')
    assert decoded.returncode==0,decoded.stderr
record={'file':video.name,'mediaDurationSeconds':duration,'bytes':video.stat().st_size,'codec':'VP8','resolution':'1440x1000','decodedFrames':3,'lessThan15Minutes':True,'hasSpokenAudio':False,'narration':'中文字幕覆盖实际操作与讲解页面'}
(evidence/'video-validation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),'utf-8')
print('Verified actual WebM duration:',duration,'seconds; decoded 3 proof frames; size:',video.stat().st_size,'bytes.')
