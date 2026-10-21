// Mise à jour de l'appli : la page vérifie la dernière release GitHub et, si l'utilisateur
// clique sur « Mettre à jour », l'exe télécharge la nouvelle version à côté de lui,
// prend sa place (un exe en cours d'exécution peut être renommé sous Windows) et se relance.
package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const updatedFlag = "--updated" // passé à la nouvelle version : l'ancienne est en train de se fermer

// Pages de releases acceptées : le dépôt actuel et sa future adresse (organisation wakforge).
var releasesPages = []string{
	"https://github.com/Phhanuel/Wak-Forge/releases",
	"https://github.com/wakforge/wakforge.github.io/releases",
}

// fromReleases dit si url est une page (ou, avec sub, un sous-chemin) des releases du projet.
func fromReleases(url, sub string) bool {
	u := strings.ToLower(url)
	for _, p := range releasesPages {
		if strings.HasPrefix(u, strings.ToLower(p+sub)) {
			return true
		}
	}
	return false
}

var procShellExecuteW = shell32.NewProc("ShellExecuteW")

// openURL ouvre une page GitHub du projet dans le navigateur par défaut.
func openURL(url string) {
	if !fromReleases(url, "") {
		return
	}
	verb, _ := windows.UTF16PtrFromString("open")
	u, _ := windows.UTF16PtrFromString(url)
	procShellExecuteW.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(u)), 0, 0, swShow)
}

// selfUpdate télécharge l'exe de la release puis remplace l'exe actuel. Il ne reste qu'à relancer.
func selfUpdate(url string) (string, error) {
	if !fromReleases(url, "/download/") || !strings.HasSuffix(strings.ToLower(url), ".exe") {
		return "", errors.New("adresse de téléchargement inattendue")
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}

	client := &http.Client{Timeout: 3 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("téléchargement impossible : %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("téléchargement impossible (HTTP %d)", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 200<<20))
	if err != nil {
		return "", fmt.Errorf("téléchargement interrompu : %w", err)
	}
	if len(data) < 1<<20 || !bytes.HasPrefix(data, []byte("MZ")) {
		return "", errors.New("le fichier téléchargé n'est pas un exe valide")
	}

	newPath, oldPath := exe+".new", exe+".old"
	if err := os.WriteFile(newPath, data, 0o755); err != nil {
		return "", fmt.Errorf("écriture impossible dans %s : %w", filepath.Dir(exe), err)
	}
	_ = os.Remove(oldPath)
	if err := os.Rename(exe, oldPath); err != nil {
		_ = os.Remove(newPath)
		return "", fmt.Errorf("remplacement impossible : %w", err)
	}
	if err := os.Rename(newPath, exe); err != nil {
		_ = os.Rename(oldPath, exe)
		_ = os.Remove(newPath)
		return "", fmt.Errorf("remplacement impossible : %w", err)
	}
	return exe, nil
}

// relaunch démarre la nouvelle version, qui attend que celle-ci soit fermée.
func relaunch(exe string) error {
	cmd := exec.Command(exe, updatedFlag)
	cmd.Dir = filepath.Dir(exe)
	return cmd.Start()
}

// justUpdated : lancé par l'ancienne version après une mise à jour.
func justUpdated() bool {
	for _, a := range os.Args[1:] {
		if a == updatedFlag {
			return true
		}
	}
	return false
}

// cleanupOld supprime l'ancienne version laissée par la mise à jour (dès qu'elle est fermée).
func cleanupOld() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	old := exe + ".old"
	for i := 0; i < 30; i++ {
		if err := os.Remove(old); err == nil || os.IsNotExist(err) {
			return
		}
		time.Sleep(time.Second)
	}
}
