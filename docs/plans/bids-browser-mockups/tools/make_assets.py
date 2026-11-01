"""Render brain thumbnails for the mockups from a NIfTI template (numpy + Pillow, no nibabel).

usage: python3 -I tools/make_assets.py test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii cruft/bids-design/assets.json
All images are derived from the template; signal dropout, ghosting and the carpet plot are synthetic.
"""
import sys, struct, json, base64, io
import numpy as np
from PIL import Image, ImageFilter
src, out = sys.argv[1], sys.argv[2]
raw = open(src,'rb').read()
hdr = raw[:348]
dims = struct.unpack('<8h', hdr[40:56]); dt = struct.unpack('<h', hdr[70:72])[0]
vox = struct.unpack('<f', hdr[108:112])[0]
nx,ny,nz = dims[1:4]
dtype = {2:np.uint8,4:np.int16,16:np.float32,64:np.float64,512:np.uint16}[dt]
v = np.frombuffer(raw, dtype=dtype, offset=int(vox), count=nx*ny*nz).reshape((nz,ny,nx)).astype(np.float32)
v = v.transpose(2,1,0)  # x,y,z
v /= np.percentile(v[v>0], 99.5)
v = np.clip(v,0,1)
def png(a, size=None, blur=0):
    im = Image.fromarray((np.clip(a,0,1)*255).astype(np.uint8))
    if blur: im = im.filter(ImageFilter.GaussianBlur(blur))
    if size: im = im.resize(size, Image.BILINEAR)
    b = io.BytesIO(); im.save(b,'PNG',optimize=True); return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
ax = lambda z: np.rot90(v[:,:,z])
co = lambda y: np.rot90(v[:,y,:])
sa = lambda x: np.rot90(v[x,:,:])
assets = {}
assets['t1_ax'] = png(ax(nz//2+8), (150,180))
assets['t1_co'] = png(co(ny//2), (150,130))
assets['t1_sa'] = png(sa(nx//2), (180,130))
# EPI-like: downsample, invert-ish (CSF bright), blur
mask = (v>0.05).astype(np.float32)
epi = (0.55 + 0.6*(1-v))*mask
epi = epi[::3,::3,::3]
from numpy.random import default_rng
rng = default_rng(3)
def epi_ax(z, drop=False, ghost=False, motion=False):
    s = np.rot90(epi[:,:,z]).copy()
    if drop:
        h,w = s.shape; yy,xx = np.mgrid[0:h,0:w]
        s *= 1-0.85*np.exp(-(((yy-h*0.24)/(h*0.10))**2+((xx-w*0.5)/(w*0.22))**2))
    if ghost:
        s = s + 0.28*np.roll(s, s.shape[0]//2, axis=0)
    if motion:
        s[::4,:] *= 0.55
    s += rng.normal(0,0.04,s.shape)
    return s
ez = epi.shape[2]
assets['bold_ax'] = png(epi_ax(int(ez*0.55)), (120,144), blur=0.6)
assets['bold_drop'] = png(epi_ax(int(ez*0.40), drop=True), (120,144), blur=0.6)
assets['bold_ghost'] = png(epi_ax(int(ez*0.55), ghost=True), (120,144), blur=0.6)
# mosaic of 12 axial epi slices
zs = np.linspace(int(ez*0.22), int(ez*0.82), 12).astype(int)
tiles = [epi_ax(z) for z in zs]
h,w = tiles[0].shape
m = np.zeros((h*2, w*6))
for i,t in enumerate(tiles): m[(i//6)*h:(i//6+1)*h, (i%6)*w:(i%6+1)*w] = t
assets['bold_mosaic'] = png(m, (w*6*3, h*2*3), blur=0.8)
zs = np.linspace(int(nz*0.25), int(nz*0.8), 8).astype(int)
tiles = [ax(z) for z in zs]; h,w = tiles[0].shape
m = np.zeros((h, w*8))
for i,t in enumerate(tiles): m[:, i*w:(i+1)*w] = t
assets['t1_mosaic'] = png(m, (w*8//2, h//2))
# dwi-like b0: T2ish, smoother
dwi = ((0.4+0.8*(1-v))*mask)[::2,::2,::2]
assets['dwi_ax'] = png(np.rot90(dwi[:,:,int(dwi.shape[2]*0.55)]), (120,144), blur=1.0)
# T2w: invert within mask
t2 = (0.25+0.85*(1-v))*mask
assets['t2_ax'] = png(np.rot90(t2[:,:,nz//2+8]), (150,180), blur=0.3)
# carpet plot: synthetic voxels x time from rng with motion spikes
T=240; N=160
base = rng.normal(0,1,(N,T)); base = np.cumsum(base,axis=1)*0.03 + rng.normal(0,0.6,(N,T))
for t0 in (61,62,148,201): base[:,t0] += rng.normal(1.8,0.5,N)
base = (base - base.min())/(base.max()-base.min())
assets['carpet'] = png(base, (480,140))
json.dump(assets, open(out,'w'))
print(dims, dt, {k:len(x) for k,x in assets.items()})
