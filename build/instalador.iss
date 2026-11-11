; Instalador del agente de impresion de Comerzio (Inno Setup 6). Lo compila scripts/build.mjs:
;   ISCC /DAppVersion=x.y.z build\instalador.iss
; Sin caracteres no ASCII a proposito: ISCC lee los .iss sin BOM como ANSI.

#ifndef AppVersion
  #error Falta /DAppVersion=x.y.z
#endif

[Setup]
AppId={{6C1C2E0B-3E5A-4F7B-9D2C-5B0E8A4F1C77}
AppName=Comerzio - Agente de impresion
AppVersion={#AppVersion}
AppPublisher=Comerzio
DefaultDirName={autopf}\Comerzio\PrintAgent
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=ComerzioPrintAgent-Setup
Compression=lzma2/max
SolidCompression=yes
UninstallDisplayName=Comerzio - Agente de impresion
WizardStyle=modern

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "..\dist\ComerzioPrintAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "vendor\WinSW-x64.exe"; DestDir: "{app}"; DestName: "ComerzioPrintAgentService.exe"; Flags: ignoreversion
Source: "servicio.xml"; DestDir: "{app}"; DestName: "ComerzioPrintAgentService.xml"; Flags: ignoreversion

[Run]
Filename: "{app}\ComerzioPrintAgentService.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Registrando el servicio..."
Filename: "{app}\ComerzioPrintAgentService.exe"; Parameters: "start"; Flags: runhidden waituntilterminated; StatusMsg: "Iniciando el agente..."

[UninstallRun]
Filename: "{app}\ComerzioPrintAgentService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "DetenerServicio"
Filename: "{app}\ComerzioPrintAgentService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "QuitarServicio"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\staging"
Type: files; Name: "{app}\ComerzioPrintAgent.exe.old"
Type: files; Name: "{app}\raw-print.ps1"

[Code]
// Reinstalar encima de una instalacion existente: bajar y quitar el servicio antes de copiar,
// porque con el servicio corriendo el exe esta en uso y no se puede sobrescribir.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Servicio: String;
  Codigo: Integer;
begin
  Servicio := ExpandConstant('{app}\ComerzioPrintAgentService.exe');
  if FileExists(Servicio) then
  begin
    Exec(Servicio, 'stop', '', SW_HIDE, ewWaitUntilTerminated, Codigo);
    Exec(Servicio, 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, Codigo);
  end;
  Result := '';
end;
