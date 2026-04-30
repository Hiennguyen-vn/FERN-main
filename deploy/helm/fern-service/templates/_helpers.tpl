{{- define "fern-service.name" -}}
{{ .Values.serviceName }}
{{- end -}}

{{- define "fern-service.labels" -}}
app.kubernetes.io/name: {{ include "fern-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: backend
{{- end -}}

{{- define "fern-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "fern-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "fern-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{ default (include "fern-service.name" .) .Values.serviceAccount.name }}
{{- else -}}
{{ default "default" .Values.serviceAccount.name }}
{{- end -}}
{{- end -}}
