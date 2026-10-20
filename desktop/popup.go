// Fenêtre de scan : après Ctrl+D, la fenêtre de Wak'Forge devient un petit panneau sans bordure,
// au premier plan, à côté de la souris. La page y affiche l'objet scanné pour choisir la rareté
// et la quantité ; en validant (ou en annulant), la fenêtre reprend sa taille et sa place,
// et le jeu retrouve le focus.

package main

import (
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procMonitorFromPoint  = user32.NewProc("MonitorFromPoint")
	procGetMonitorInfoW   = user32.NewProc("GetMonitorInfoW")
	procAttachThreadInput = user32.NewProc("AttachThreadInput")
	procBringWindowToTop  = user32.NewProc("BringWindowToTop")
)

const (
	gwlStyle             = ^uintptr(15) // GWL_STYLE (-16)
	wsCaption            = 0x00C00000
	wsThickFrame         = 0x00040000
	wsMinimizeBox        = 0x00020000
	wsMaximizeBox        = 0x00010000
	swpFrameChanged      = 0x0020
	swpShowWindow        = 0x0040
	swMaximize           = 3
	swShowMinNoActive    = 7
	wsExTopmost          = 0x00000008
	monitorDefaultToNear = 2
)

type monitorInfo struct {
	CbSize    uint32
	RcMonitor rect
	RcWork    rect
	DwFlags   uint32
}

// position de la souris et fenêtre au premier plan (le jeu) au moment du Ctrl+D
var (
	scanOriginMu sync.Mutex
	scanOrigin   point
	scanPrevFg   uintptr
)

func rememberScanOrigin() {
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	scanOriginMu.Lock()
	scanOrigin = pt
	scanPrevFg = uintptr(windows.GetForegroundWindow())
	scanOriginMu.Unlock()
}

var popup struct {
	on             bool
	saved          rect
	style          uintptr
	zoomed, iconic bool
	prevFg         uintptr
}

// popupRect place le panneau à côté du curseur, dans la zone de travail de son écran.
func popupRect(pt point) rect {
	w, h, gap := int32(dpiScale(400)), int32(dpiScale(370)), int32(dpiScale(28))
	wa := rect{0, 0, int32(dpiScale(1280)), int32(dpiScale(720))}
	mon, _, _ := procMonitorFromPoint.Call(uintptr(uint32(pt.X))|uintptr(uint32(pt.Y))<<32, monitorDefaultToNear)
	if mon != 0 {
		mi := monitorInfo{}
		mi.CbSize = uint32(unsafe.Sizeof(mi))
		if r, _, _ := procGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi))); r != 0 {
			wa = mi.RcWork
		}
	}
	x := pt.X + gap
	if x+w > wa.R {
		x = pt.X - gap - w // pas la place à droite : à gauche du curseur
	}
	x = int32(clamp(int(x), int(wa.L), int(wa.R-w)))
	y := int32(clamp(int(pt.Y-h/2), int(wa.T), int(wa.B-h)))
	return rect{L: x, T: y, R: x + w, B: y + h}
}

// setScanPopup ouvre (on) ou referme le panneau de scan. refocus rend le focus au jeu en le refermant.
func setScanPopup(hwnd uintptr, on, refocus bool) {
	if on == popup.on {
		if on {
			forceForeground(hwnd)
		}
		return
	}
	if on {
		scanOriginMu.Lock()
		pt, prev := scanOrigin, scanPrevFg
		scanOriginMu.Unlock()
		if prev == hwnd {
			prev = 0
		}
		popup.prevFg = prev
		r, _, _ := procIsIconic.Call(hwnd)
		popup.iconic = r != 0
		z, _, _ := procIsZoomed.Call(hwnd)
		popup.zoomed = z != 0
		if popup.iconic || popup.zoomed {
			procShowWindow.Call(hwnd, swRestore)
		}
		popup.saved = windowRect(hwnd)
		popup.style, _, _ = procGetWindowLongW.Call(hwnd, gwlStyle)
		procSetWindowLongW.Call(hwnd, gwlStyle, popup.style&^(wsCaption|wsThickFrame|wsMinimizeBox|wsMaximizeBox))
		if inOverlay {
			setOpacity(hwnd, 255)
		}
		pr := popupRect(pt)
		procSetWindowPos.Call(hwnd, hwndTopmost, uintptr(int(pr.L)), uintptr(int(pr.T)),
			uintptr(int(pr.R-pr.L)), uintptr(int(pr.B-pr.T)), swpFrameChanged|swpShowWindow)
		forceForeground(hwnd)
		popup.on = true
		return
	}
	popup.on = false
	// On rend d'abord la main au jeu, puis on remet la fenêtre à sa taille DERRIÈRE lui, en un seul
	// déplacement et sans l'activer : elle ne repasse pas au premier plan le temps d'un éclair.
	// Exception : « Voir la provenance » (refocus faux alors qu'on a le focus) garde l'appli devant.
	stayFront := !refocus && uintptr(windows.GetForegroundWindow()) == hwnd
	if refocus && popup.prevFg != 0 {
		procSetForeground.Call(popup.prevFg)
	}
	after := hwndNotTopmost
	if fg := uintptr(windows.GetForegroundWindow()); !stayFront && fg != 0 && fg != hwnd {
		// juste sous la fenêtre active (le jeu) ; si elle est elle-même « toujours devant »,
		// se glisser après elle nous laisserait « toujours devant » aussi
		if ex, _, _ := procGetWindowLongW.Call(fg, gwlExStyle); ex&wsExTopmost == 0 {
			after = fg
		}
	}
	if topmost || inOverlay {
		after = hwndTopmost
	}
	flags := uintptr(swpFrameChanged)
	if !stayFront {
		flags |= swpNoActivate
	}
	procSetWindowLongW.Call(hwnd, gwlStyle, popup.style)
	s := popup.saved
	procSetWindowPos.Call(hwnd, after, uintptr(int(s.L)), uintptr(int(s.T)),
		uintptr(int(s.R-s.L)), uintptr(int(s.B-s.T)), flags)
	if inOverlay {
		setOpacity(hwnd, overlayAlpha)
	}
	switch {
	case popup.zoomed:
		procShowWindow.Call(hwnd, swMaximize) // Windows n'a pas d'« agrandir sans activer »
		if !stayFront && popup.prevFg != 0 {
			procSetForeground.Call(popup.prevFg)
		}
	case popup.iconic && !stayFront:
		procShowWindow.Call(hwnd, swShowMinNoActive)
	}
}

// forceForeground donne le focus à la fenêtre. Windows peut le refuser à une appli en arrière-plan :
// on s'attache alors au fil de la fenêtre active (le jeu) le temps de prendre la main.
func forceForeground(hwnd uintptr) {
	procSetForeground.Call(hwnd)
	fg := windows.GetForegroundWindow()
	if uintptr(fg) == hwnd || fg == 0 {
		return
	}
	fgThread, _ := windows.GetWindowThreadProcessId(fg, nil)
	me := windows.GetCurrentThreadId()
	if fgThread == 0 || fgThread == me {
		return
	}
	procAttachThreadInput.Call(uintptr(me), uintptr(fgThread), 1)
	procBringWindowToTop.Call(hwnd)
	procSetForeground.Call(hwnd)
	procAttachThreadInput.Call(uintptr(me), uintptr(fgThread), 0)
}
