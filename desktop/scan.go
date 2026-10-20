// Scan d'objet : Ctrl+D au-dessus d'un objet dans WAKFU.
//
// L'appli ne touche pas au jeu : elle fait une capture d'écran locale autour de la souris,
// la lit avec la reconnaissance de texte intégrée à Windows (Windows.Media.Ocr, via PowerShell),
// et envoie les lignes lues à la page, qui retrouve l'objet dans data_item.json.
// Le raccourci n'est enregistré que lorsque la fenêtre de WAKFU est au premier plan :
// Ctrl+D garde son rôle habituel dans les autres applis.

package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

//go:embed ocr.ps1
var ocrScript []byte

var (
	gdi32 = windows.NewLazySystemDLL("gdi32.dll")

	procRegisterHotKey   = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey = user32.NewProc("UnregisterHotKey")
	procPeekMessageW     = user32.NewProc("PeekMessageW")
	procGetCursorPos     = user32.NewProc("GetCursorPos")
	procGetWindowTextW   = user32.NewProc("GetWindowTextW")
	procGetDC            = user32.NewProc("GetDC")
	procReleaseDC        = user32.NewProc("ReleaseDC")

	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procBitBlt                 = gdi32.NewProc("BitBlt")
	procGetDIBits              = gdi32.NewProc("GetDIBits")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
)

const (
	hotkeyID     = 0x5743 // « WC »
	modControl   = 0x0002
	modNoRepeat  = 0x4000
	vkD          = 0x44
	wmHotkey     = 0x0312
	pmRemove     = 0x0001
	srcCopy      = 0x00CC0020
	captureBlt   = 0x40000000
	smXVirtual   = 76
	smYVirtual   = 77
	smCXVirtual  = 78
	smCYVirtual  = 79
	dibRGBColors = 0
)

type point struct{ X, Y int32 }

type winMsg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
	_       uint32
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// scanResult est envoyé à la page (window.wfScan).
type scanResult struct {
	Pending bool     `json:"pending,omitempty"`
	Lines   []string `json:"lines,omitempty"`
	Error   string   `json:"error,omitempty"`
}

var scanEnabled atomic.Bool

// startScanHotkey lance la boucle du raccourci dans son propre thread Windows.
// send est appelé (depuis ce thread) avec chaque résultat à transmettre à la page.
func startScanHotkey(self uintptr, send func(scanResult)) {
	scanEnabled.Store(true)
	go func() {
		runtime.LockOSThread() // RegisterHotKey(NULL) poste WM_HOTKEY dans la file de CE thread
		registered := false
		var busy atomic.Bool
		var msg winMsg
		for {
			want := scanEnabled.Load() && wakfuInFront(self)
			if want && !registered {
				r, _, _ := procRegisterHotKey.Call(0, hotkeyID, modControl|modNoRepeat, vkD)
				registered = r != 0
			} else if !want && registered {
				procUnregisterHotKey.Call(0, hotkeyID)
				registered = false
			}
			for {
				r, _, _ := procPeekMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0, pmRemove)
				if r == 0 {
					break
				}
				if msg.Message == wmHotkey && msg.WParam == hotkeyID && busy.CompareAndSwap(false, true) {
					send(scanResult{Pending: true})
					go func() {
						send(runScan())
						busy.Store(false)
					}()
				}
			}
			time.Sleep(60 * time.Millisecond)
		}
	}()
}

// wakfuInFront indique si la fenêtre au premier plan est celle du jeu.
func wakfuInFront(self uintptr) bool {
	h := windows.GetForegroundWindow()
	if h == 0 || uintptr(h) == self {
		return false
	}
	var pid uint32
	if _, err := windows.GetWindowThreadProcessId(h, &pid); err == nil && pid != 0 {
		if p, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid); err == nil {
			buf := make([]uint16, 520)
			n := uint32(len(buf))
			if windows.QueryFullProcessImageName(p, 0, &buf[0], &n) == nil {
				exe := strings.ToLower(filepath.Base(windows.UTF16ToString(buf[:n])))
				windows.CloseHandle(p)
				if strings.Contains(exe, "wakfu") {
					return true
				}
			} else {
				windows.CloseHandle(p)
			}
		}
	}
	title := make([]uint16, 256)
	procGetWindowTextW.Call(uintptr(h), uintptr(unsafe.Pointer(&title[0])), uintptr(len(title)))
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(windows.UTF16ToString(title))), "WAKFU")
}

// runScan capture la zone autour de la souris puis la lit avec l'OCR de Windows.
func runScan() scanResult {
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))

	// zone large : l'infobulle de l'objet peut s'afficher d'un côté ou de l'autre du curseur
	vx, _, _ := procGetSystemMetrics.Call(smXVirtual)
	vy, _, _ := procGetSystemMetrics.Call(smYVirtual)
	vw, _, _ := procGetSystemMetrics.Call(smCXVirtual)
	vh, _, _ := procGetSystemMetrics.Call(smCYVirtual)
	minX, minY := int(int32(vx)), int(int32(vy))
	maxX, maxY := minX+int(int32(vw)), minY+int(int32(vh))
	w, h := int(dpiScale(900)), int(dpiScale(760))
	x := clamp(int(pt.X)-w/2, minX, maxX-w)
	y := clamp(int(pt.Y)-int(dpiScale(360)), minY, maxY-h)

	img, err := captureScreen(x, y, w, h)
	if err != nil {
		return scanResult{Error: "Capture d'écran impossible : " + err.Error()}
	}
	img = upscale2x(img) // le texte des infobulles est petit : l'OCR lit mieux en plus grand

	dir := filepath.Join(os.TempDir(), "WakForge")
	_ = os.MkdirAll(dir, 0o755)
	imgPath := filepath.Join(dir, "scan.png")
	scriptPath := filepath.Join(dir, "ocr.ps1")
	defer os.Remove(imgPath)
	f, err := os.Create(imgPath)
	if err != nil {
		return scanResult{Error: err.Error()}
	}
	err = png.Encode(f, img)
	f.Close()
	if err != nil {
		return scanResult{Error: err.Error()}
	}
	if err := os.WriteFile(scriptPath, ocrScript, 0o644); err != nil {
		return scanResult{Error: err.Error()}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, imgPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			msg = strings.TrimSpace(string(ee.Stderr))
		}
		if msg == "" {
			msg = err.Error()
		}
		return scanResult{Error: "Lecture du texte impossible : " + msg}
	}
	var lines []string
	for _, l := range strings.Split(strings.TrimPrefix(string(out), "\ufeff"), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			lines = append(lines, l)
		}
	}
	return scanResult{Lines: lines}
}

func clamp(v, lo, hi int) int {
	if v > hi {
		v = hi
	}
	if v < lo {
		v = lo
	}
	return v
}

func captureScreen(x, y, w, h int) (*image.RGBA, error) {
	screen, _, _ := procGetDC.Call(0)
	if screen == 0 {
		return nil, syscall.EINVAL
	}
	defer procReleaseDC.Call(0, screen)
	mem, _, _ := procCreateCompatibleDC.Call(screen)
	defer procDeleteDC.Call(mem)
	bmp, _, _ := procCreateCompatibleBitmap.Call(screen, uintptr(w), uintptr(h))
	if bmp == 0 {
		return nil, syscall.ENOMEM
	}
	defer procDeleteObject.Call(bmp)
	old, _, _ := procSelectObject.Call(mem, bmp)
	procBitBlt.Call(mem, 0, 0, uintptr(w), uintptr(h), screen, uintptr(x), uintptr(y), srcCopy|captureBlt)
	procSelectObject.Call(mem, old)

	hdr := bitmapInfoHeader{Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32}
	hdr.Size = uint32(unsafe.Sizeof(hdr))
	buf := make([]byte, w*h*4)
	r, _, _ := procGetDIBits.Call(mem, bmp, 0, uintptr(h), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&hdr)), dibRGBColors)
	if r == 0 {
		return nil, syscall.EINVAL
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(buf); i += 4 { // BGRA -> RGBA
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = buf[i+2], buf[i+1], buf[i], 255
	}
	return img, nil
}

// upscale2x agrandit l'image ×2 (interpolation bilinéaire).
func upscale2x(src *image.RGBA) *image.RGBA {
	sw, sh := src.Rect.Dx(), src.Rect.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, sw*2, sh*2))
	for y := 0; y < sh*2; y++ {
		fy := float64(y)/2 - 0.25
		y0 := clamp(int(fy), 0, sh-1)
		y1 := clamp(y0+1, 0, sh-1)
		ty := fy - float64(y0)
		if ty < 0 {
			ty = 0
		}
		for x := 0; x < sw*2; x++ {
			fx := float64(x)/2 - 0.25
			x0 := clamp(int(fx), 0, sw-1)
			x1 := clamp(x0+1, 0, sw-1)
			tx := fx - float64(x0)
			if tx < 0 {
				tx = 0
			}
			d := dst.PixOffset(x, y)
			for c := 0; c < 3; c++ {
				p00 := float64(src.Pix[src.PixOffset(x0, y0)+c])
				p10 := float64(src.Pix[src.PixOffset(x1, y0)+c])
				p01 := float64(src.Pix[src.PixOffset(x0, y1)+c])
				p11 := float64(src.Pix[src.PixOffset(x1, y1)+c])
				v := (p00*(1-tx)+p10*tx)*(1-ty) + (p01*(1-tx)+p11*tx)*ty
				dst.Pix[d+c] = uint8(v + 0.5)
			}
			dst.Pix[d+3] = 255
		}
	}
	return dst
}

func scanJSON(r scanResult) string {
	b, _ := json.Marshal(r)
	return string(b)
}
