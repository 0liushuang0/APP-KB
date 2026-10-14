"""模型加载: 本机有缓存时只用本地文件(不联网检查更新), 没有缓存才联网下载"""
from app.core.embeddings import load_hf_model


class Fake:
    calls = []

    def __init__(self, name, local_files_only=False):
        Fake.calls.append(local_files_only)
        if local_files_only and name == "not-cached":
            raise OSError("not in cache")
        self.name = name


def test_cached_model_loads_offline():
    Fake.calls = []
    m = load_hf_model(Fake, "cached")
    assert m.name == "cached" and Fake.calls == [True]


def test_uncached_model_falls_back_to_download():
    Fake.calls = []
    m = load_hf_model(Fake, "not-cached")
    assert m.name == "not-cached" and Fake.calls == [True, False]
