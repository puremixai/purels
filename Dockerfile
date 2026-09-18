FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/purels-api ./cmd/purels-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/purels-worker ./cmd/purels-worker

FROM alpine:3.22
RUN adduser -D -H -u 10001 purels
COPY --from=build /out/purels-api /app/purels-api
COPY --from=build /out/purels-worker /app/purels-worker
USER purels
EXPOSE 8080
ENTRYPOINT ["/app/purels-api"]
