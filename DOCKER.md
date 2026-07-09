# Docker: сборка и запуск

## Быстрый старт

```bash
# 1. Собрать образ
docker build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_YANDEX_METRIKA_ID=107091121 \
  -t ido-calisthenics .

# 2. Запустить контейнер (порт 8080)
docker run -p 8080:8080 ido-calisthenics

# 3. Открыть в браузере
# http://localhost:8080
```

## Свой ID счётчика при сборке

```bash
docker build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_YANDEX_METRIKA_ID=107091121 \
  -t ido-calisthenics .
```

## Проверка

```bash
# Убедиться, что образ есть
docker images | grep ido-calisthenics

# Запущен ли контейнер
docker ps

# Остановить
docker stop <container_id>
# или: docker stop $(docker ps -q --filter ancestor=ido-calisthenics)
```

## Для Yandex Cloud Serverless Containers

1. В CI/CD или при ручной сборке передать build-arg:
   ```bash
   docker build \
     --platform linux/amd64 \
     --build-arg NEXT_PUBLIC_YANDEX_METRIKA_ID=107091121 \
     -t <registry>/ido-calisthenics .
   ```

2. `NEXT_PUBLIC_YANDEX_METRIKA_ID` нужен именно на этапе `docker build`: Next.js встраивает `NEXT_PUBLIC_*` в статический bundle при `npm run build`. Передача этой переменной только в `docker run -e` не включит Метрику в уже собранный образ.

3. Передача `NEXT_PUBLIC_YANDEX_METRIKA_ID` через `yc serverless container revision deploy --environment` не исправляет уже собранный client bundle. Для Метрики нужен именно `--build-arg` при сборке образа.
